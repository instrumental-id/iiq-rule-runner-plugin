/*
 * Copyright (c) 2024 Devin Rosenbauer and others
 *
 * Licensed under the MIT License.
 * You may obtain a copy of the License at https://mit-license.org/
 *
 * Contributors:
 *     Devin Rosenbauer
 *     Zac Adams
 * 
 */
package com.identityworksllc.iiq.plugins.rrp;

import com.identityworksllc.iiq.common.Functions;
import com.identityworksllc.iiq.common.Utilities;
import com.identityworksllc.iiq.common.plugin.BaseCommonPluginResource;
import com.identityworksllc.iiq.common.plugin.annotations.ResponsesAllowed;
import com.identityworksllc.iiq.common.threads.SailPointWorker;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.glassfish.jersey.media.multipart.FormDataContentDisposition;
import org.glassfish.jersey.media.multipart.FormDataParam;
import sailpoint.api.*;
import sailpoint.api.logging.SyslogThreadLocal;
import sailpoint.object.*;
import sailpoint.rest.plugin.BasePluginResource;
import sailpoint.rest.plugin.RequiredRight;
import sailpoint.server.Auditor;
import sailpoint.task.Monitor;
import sailpoint.task.TaskMonitor;
import sailpoint.tools.GeneralException;
import sailpoint.tools.RFC4180LineIterator;
import sailpoint.tools.RFC4180LineParser;
import sailpoint.tools.Util;
import sailpoint.tools.xml.AbstractXmlObject;
import sailpoint.workflow.WorkflowContext;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import javax.ws.rs.*;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.sql.Connection;
import java.text.CharacterIterator;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.text.StringCharacterIterator;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.stream.Collectors;

/**
 * The REST API resource invoked by the client-side TypeScript UI.
 *
 * @author Devin Rosenbauer (devin@instrumentalid.com)
 * @author Zac Adams (zac@instrumentalid.com)
 * @author Instrumental Identity
 */
@Path("IDWRuleRunnerPlugin")
public class RuleRunnerResource extends BaseCommonPluginResource {
	/**
	 * The secondary thread serving to monitor and control a running rule thread. After the timeout
	 * timestamp has passed, this thread will attempt to interrupt the running rule, which ought to
	 * stop if it has been properly augmented by {@link #addInterrupts(String)}.
	 */
	public static class RuleRunnerMonitorThread extends Thread {
		/**
		 * Set to true whenever an abort is requested
		 */
		private final AtomicBoolean abort;

		/**
		 * The background rule-running thread being monitored by this thread. This reference
		 * keeps the background object from being garbage collected.
		 */
		private final Thread backgroundThread;

		/**
		 * The enhanced logger associated with this thread
		 */
		private final Log log;

		private final Log passthroughLog;

		/**
		 * The timeout timestamp, set by the user, 10 minutes by default
		 */
		private final long timeoutTimestamp;

		/**
		 * The worker associated with the background thread
		 */
		private final RuleRunnerAsyncWorker worker;

		public RuleRunnerMonitorThread(Thread backgroundThread, RuleRunnerAsyncWorker worker, Log log, long timeout, TimeUnit timeoutUnit) {
			super.setPriority(3);
			super.setName("RRMonitor - " + backgroundThread.getName() + " - " + (System.currentTimeMillis() / 1000));
			super.setDaemon(true);

			this.abort = new AtomicBoolean();
			this.backgroundThread = backgroundThread;
			this.worker = worker;

			this.timeoutTimestamp = System.currentTimeMillis() + TimeUnit.MILLISECONDS.convert(timeout, timeoutUnit);
			this.passthroughLog = log;
			this.log = LogFactory.getLog(getClass());
		}

		/**
		 * Sets the abort flag, which will attempt to terminate the running rule on the next loop
		 */
		public void abort() {
			this.abort.set(true);
		}

		@Override
		public void run() {
			String backgroundThreadName = backgroundThread.getName();
			try {
				// Initial sleep to give the background thread time to start
				Thread.sleep(10000L);
				while (System.currentTimeMillis() < timeoutTimestamp && backgroundThread.isAlive() && !abort.get()) {
					Thread.sleep(1000L);
				}
				if (backgroundThread.isAlive()) {
					long start = System.currentTimeMillis();
					if (abort.get()) {
						passthroughLog.warn("The background worker running in thread " + backgroundThreadName + " has been terminated by the user. Attempting to stop it...");
					} else {
						passthroughLog.warn("The background worker running in thread " + backgroundThreadName + " has timed out. Attempting to stop it...");
					}
					backgroundThread.interrupt();
					worker.terminate();
					for(int attempts = 0; attempts < 10; attempts++) {
						backgroundThread.join(10 * 1000L);
						if (backgroundThread.isAlive()) {
							long elapsed = (System.currentTimeMillis() - start) / 1000;
							log.info("Waiting for background thread " + backgroundThreadName + " to stop (" + elapsed + " seconds elapsed)...");
						}
					}
					if (backgroundThread.isAlive()) {
						long elapsed = (System.currentTimeMillis() - start) / 1000;
						passthroughLog.error("Could not terminate background thread " + backgroundThreadName + " after waiting " + elapsed + " seconds! It is likely dangling and may cause performance problems!");
					}
				} else {
					log.info("The background rule runner worker stopped normally");
				}
			} catch(InterruptedException e) {
				log.warn("Monitor thread interrupted; interrupting monitored worker thread " + backgroundThreadName);
				if (backgroundThread.isAlive()) {
					backgroundThread.interrupt();
				}
			} catch(Exception e) {
				log.error("Caught an exception waiting for Rule Runner background thread " + backgroundThreadName, e);
			}
		}
	}

	/**
	 * The implementation of the Rule Runner background thread. This class will be added to
	 * the {@link #backgroundThreads} map if the duration of the rule execution is longer than
	 * the synchronous timeout (usually 2 seconds).
	 */
	public static class RuleRunnerAsyncWorker extends SailPointWorker {
		/**
		 * True if we ought to create a task result for this rule execution
		 */
		private final boolean createTaskResult;
		/**
		 * the UUID of this thread, the key in {@link #backgroundThreads}.
		 */
		private String key;
		/**
		 * The logger, which will be piped back to the user in the brower
		 */
		private final LogStreamWrapper log;
		/**
		 * The monitor thread, which will kill this thread after the timeout elapses
		 */
		private RuleRunnerMonitorThread monitorThread;
		/**
		 * The output object, which can be anything
		 */
		private Object output;
		/**
		 * The Identity name who started this worker
		 */
		private final String ownerIdentity;
		/**
		 * The input parameters
		 */
		private final Map<String, Object> params;
		/**
		 * The actual Rule being executed, usually something ad-hoc
		 */
		private final Rule rule;
		/**
		 * A task monitor
		 */
		private final RuleRunnerTaskMonitor taskMonitor;

		/**
		 * The timestamp
		 */
		private final long timestamp;

		public RuleRunnerAsyncWorker(Rule rule, Map<String, Object> params, LogStreamWrapper log, boolean createTaskResult, String ownerIdentity) {
			this.rule = rule;
			this.params = new HashMap<>(params);
			this.log = log;
			this.key = Util.otoa(this.params.get(VAR_UUID));
			if (Util.isNullOrEmpty(this.key)) {
				this.key = UUID.randomUUID().toString();
			}

			this.createTaskResult = createTaskResult;
			this.ownerIdentity = (ownerIdentity == null) ? "spadmin" : ownerIdentity;

			this.taskMonitor = new RuleRunnerTaskMonitor();
			this.taskMonitor.setAsync(true);

			this.timestamp = System.currentTimeMillis();
		}

		/**
		 * Attempts to abort this task and its monitor
		 */
		public void abort() {
			if (this.monitorThread != null) {
				this.monitorThread.abort();
			}
			if (this.taskMonitor != null) {
				this.taskMonitor.terminate();
			}
		}

		/**
		 * The main method of this thread. Wires up the remaining rule parameters and then
		 * runs the rule in the thread context.
		 *
		 * @param context The IIQ context for the thread
		 * @param log The logger for the thread
		 * @return The object produced by the script, or an exception
         */
		@Override
		public Object execute(SailPointContext context, Log log) {
			String taskResultName = "Rule Runner - " + key;
			TaskMonitor iiqMonitor = null;
			Consumer<String> messageConsumer = (msg) -> {};

			try {
				if (createTaskResult) {
					TaskResult result = new TaskResult();
					result.setLauncher(ownerIdentity);
					result.setLaunched(new Date());
					result.setName(taskResultName);
					result.setDefinition(context.getObjectByName(TaskDefinition.class, "IDWRuleRunnerTask"));
					result.setType(TaskItemDefinition.Type.Event);
					result.setHost(Util.getHostName());

					context.saveObject(result);
					context.commitTransaction();

					result = context.getObjectByName(TaskResult.class, result.getName());
					final TaskMonitor tm = new TaskMonitor(context, result);
					tm.updateProgress("Starting execution", 0);

					setMonitor(tm);

					messageConsumer = (msg) -> {
						try {
							TaskResult tr = tm.lockMasterResult();
							try {
								tr.addMessage(msg);
							} finally {
								tm.commitMasterResult();
							}
						} catch(Exception e) {
							log.error("Caught an error logging a message from a Rule Runner thread", e);
						}
					};

					taskMonitor.setTaskMonitor(tm);

					iiqMonitor = tm;
				}

				if (!params.containsKey(VAR_LOG)) {
					params.put(VAR_LOG, this.log);
				}
				if (!params.containsKey(VAR_LOG1)) {
					params.put(VAR_LOG1, this.log);
				}
				if (!params.containsKey(VAR_LOG2)) {
					params.put(VAR_LOG2, this.log);
				}
				params.put("__worker", this);
				params.put("__message", messageConsumer);
				params.put("__uuid", key);
				params.put(VAR_MONITOR, this.taskMonitor);
				output = context.runRule(rule, params);
			} catch(Exception e) {
				output = e;
				if (log.isDebugEnabled()) {
					log.debug("Caught an exception in Run Rule worker", e);
				}
			} finally {
				this.key = null;

				// This object should have the only non-weak reference to this thread
				this.monitorThread = null;
			}

			if (iiqMonitor != null) {
				try {
					TaskResult taskResult = iiqMonitor.lockMasterResult();
					try {
						taskResult.setCompleted(new Date());
						taskResult.addMessage("Output type: " + Utilities.safeClassName(output));
						if (output instanceof Exception) {
							taskResult.addException((Exception) output);
							taskResult.setCompletionStatus(TaskResult.CompletionStatus.Error);
						} else {
							taskResult.setCompletionStatus(TaskResult.CompletionStatus.Success);
						}
					} finally {
						iiqMonitor.commitMasterResult();
					}
				} catch(GeneralException e) {
					log.error("Unable to record completion on TaskResult " + taskResultName, e);
				}
			}

			return null;
		}

		/**
		 * Gets the start timestamp
		 * @return The start timestamp
		 */
		public long getElapsedMillis() {
			return System.currentTimeMillis() - timestamp;
		}

		public String getKey() {
			return key;
		}

		public LogStreamWrapper getLog() {
			return log;
		}

		public RuleRunnerMonitorThread getMonitorThread() {
			return monitorThread;
		}

		public Object getOutput() {
			return output;
		}

		public RuleRunnerTaskMonitor getTaskMonitor() {
			return taskMonitor;
		}

		public void setMonitorThread(RuleRunnerMonitorThread monitorThread) {
			this.monitorThread = monitorThread;
		}
	}

	public static final String AUDIT_ASYNC = "async";
	public static final String AUDIT_CLIENT = "client";
	public static final String AUDIT_CODE = "code";
	public static final String AUDIT_HOST = "host";
	public static final String AUDIT_INCLUDE_WEB_CLASSES = "includeWebClasses";
	public static final String AUDIT_INPUT_VARIABLES = "inputVariables";
	public static final String AUDIT_LIBRARIES = "libraries";
	public static final String AUDIT_RUN_RULE_PLUGIN_ACTION = "runRulePluginAction";
    public static final String AUDIT_FILE_UPLOAD_PLUGIN_ACTION = "ruleRunnerFileUpload";
	public static final String AUDIT_TARGET = "Execute";
    public static final String FAKE_RULE_PREFIX = "_RuleRunnerResource";

    public static final String INPUT_ASYNC = "async";
    public static final String INPUT_CSV_INPUT = "csvInput";
	public static final String INPUT_INCLUDE_WEB_CLASSES = "includeWebClasses";
	public static final String INPUT_LIBRARIES = "libraries";
	public static final String INPUT_LIBRARY_TITLE = "title";
	public static final String INPUT_RULE_TIMEOUT = "ruleTimeout";
	public static final String INPUT_SCRIPT = "script";
	public static final String INPUT_SOURCE = "source";
	public static final String INPUT_VARIABLES = "variables";
	public static final String INPUT_VAR_TYPE_OBJECT = "object";
	public static final String INPUT_VAR_TYPE_SCRIPT = "script";
	public static final String INPUT_VAR_TYPE_VALUE = "value";
	public static final String INPUT_VAR_VALUE = "value";
	/**
	 * The snippet added to all user-entered code to allow interrupting
	 */
	public static final String INTERRUPT_SNIPPET = " if (Thread.currentThread().isInterrupted()) { throw new InterruptedException(); } ";
	public static final String LANGUAGE_BEANSHELL = "beanshell";
	public static final String OUTPUT_TYPE = "type";
	public static final String OUTPUT_VALUE = "value";
	public static final String RULE_RUNNER_BACKGROUND_THREAD = "RuleRunnerBackgroundThread - ";
    public static final String SESSION_UPLOADED_FILE_PATH = "IDW_RuleRunner_UploadedFilePath";
    public static final String VAR_CONTEXT = "context";
    public static final String VAR_CSV_DATA = "csvData";
    public static final String VAR_CSV_HEADERS = "csvHeaders";
    public static final String VAR_HTTP_REQUEST = "httpRequest";
	public static final String VAR_HTTP_RESPONSE = "httpResponse";
	public static final String VAR_LOG = "log";
	public static final String VAR_LOG1 = "_log";
	public static final String VAR_LOG2 = "__log";
	public static final String VAR_MONITOR = "monitor";
	public static final String VAR_UUID = "uuid";
	public static final String VAR_WEB_SERVICE = "webService";

	/**
	 * Background threads
	 */
	private static final Map<String, RuleRunnerAsyncWorker> backgroundThreads = new WeakHashMap<>();

	/**
	 * Modify the code by adding interrupts to it at the start of every code block.
	 * There is special handling for 'switch' blocks, because they don't allow code
	 * between the '{' and the first 'case'.
	 *
	 * @param script The script to modify
	 * @return The modified script
	 */
	public static String addInterrupts(String script) {
		StringBuilder newSource = new StringBuilder();
		boolean inQuotes = false;
		boolean isSwitch = false;
		boolean escaped = false;
		CharacterIterator iter = new StringCharacterIterator(script);
		StringBuilder word = new StringBuilder();
		for(char c = iter.first(); c != CharacterIterator.DONE; c = iter.next()) {
			// Track the last full word seen so we can look for language constructs,
			// mainly so we can fix the 'switch' construct with the interrupts.
			if (Character.isAlphabetic(c)) {
				word.append(c);
			} else if (word.length() > 0) {
				String lastWord = word.toString();
				if (lastWord.equals("switch")) {
					isSwitch = true;
				}
				word = new StringBuilder();
			}
			newSource.append(c);
			if (c == '"') {
				if (!escaped) {
					inQuotes = !inQuotes;
				}
				escaped = false;
			} else if (c == '\\') {
				escaped = !escaped;
			} else if (c == '{' && !inQuotes) {
				if (isSwitch) {
					isSwitch = false;
				} else {
					newSource.append(INTERRUPT_SNIPPET);
				}
				escaped = false;
			} else {
				// If we've reached a newline, reset the inQuotes flag
				if (c == '\n' || c == '\r') {
					inQuotes = false;
				}

				// Escaping only lasts one character
				escaped = false;
			}
		}
		return newSource.toString();
	}

	/**
	 * Derives the properly typed value of a variable, given the expected type and the value's
	 * string representation from the UI.
	 *
	 * @param context The SP context
	 * @param valueClass The expected output class
	 * @param value The input value, as entered by the user
	 * @return The proper value object
	 * @throws ParseException if the expected value is an integer and fails to aprse
	 * @throws GeneralException if any other errors occur
	 */
	private static Object deriveTypedValue(SailPointContext context, Class<?> valueClass, String value) throws ParseException, GeneralException {
		if (valueClass.equals(String.class)) {
			return value;
		} else if (valueClass.equals(Integer.class)) {
			return Integer.parseInt(value);
		} else if (valueClass.equals(Long.class)) {
			return Long.parseLong(value);
		} else if (valueClass.equals(Boolean.class)) {
			return Util.otob(value);
		} else if (Functions.isAssignableFrom(List.class, valueClass)) {
			return Util.stringToList(value);
		} else if (Functions.isAssignableFrom(Set.class, valueClass)) {
			return new HashSet<Object>(Util.stringToList(value));
		} else if (valueClass.equals(Date.class)) {
			SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd");
			return formatter.parse(value);
		} else if (Functions.isAssignableFrom(Map.class, valueClass)) {
			return Util.stringToMap(value);
		} else if (Functions.isAssignableFrom(SailPointObject.class, valueClass)) {
			return AbstractXmlObject.parseXml(context, value);
		} else if (Functions.isAssignableFrom(InputStream.class, valueClass)) {
			return new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8));
		} else if (Functions.isAssignableFrom(Reader.class, valueClass)) {
			return new StringReader(value);
		} else {
			throw new IllegalArgumentException("Unsupported object type: " + valueClass);
		}
	}

	/**
	 * Transforms the exception into a String by printing it to a ByteArrayOutputStream
	 * @param e The exception to render
	 * @return The exception string
	 */
	private static String getExceptionString(Throwable e) {
		try (ByteArrayOutputStream baos = new ByteArrayOutputStream(); PrintStream stream = new PrintStream(baos)) {
			e.printStackTrace(stream);
			return baos.toString(StandardCharsets.UTF_8.name());
		} catch(IOException e2) {
			return "";
		}
	}

	public static void populateArguments(Signature signature, String type, Map<String, ? super String> variables) {
		if (signature == null || Util.isNullOrEmpty(type)) {
			return;
		}
		for(Argument arg : Util.safeIterable(signature.getArguments())) {
			String argName = arg.getName();
			if (Util.isNullOrEmpty(argName) || argName.equals(VAR_CONTEXT) || argName.equals(VAR_LOG)) {
				continue;
			}
			String argType = arg.getType();
			if (Util.isNullOrEmpty(argType)) {
				if (argName.equals("application")) {
					argType = Application.class.getName();
				} else if (argName.equals("identity") || argName.equals("previousIdentity") || argName.equals("newIdentity")) {
					argType = Identity.class.getName();
				} else if (argName.equals("links")) {
					argType = "List<sailpoint.object.Link>";
				} else if (argName.equals("link")) {
					argType = Link.class.getName();
				} else if (argName.equals("map")) {
					argType = Map.class.getName();
				} else if (argName.equals("plan")) {
					argType = ProvisioningPlan.class.getName();
				} else if (argName.equals("project")) {
					argType = ProvisioningProject.class.getName();
				} else if (argName.equals("sourceAttributeRequest")) {
					argType = ProvisioningPlan.AttributeRequest.class.getCanonicalName();
				} else if (argName.equals("field")) {
					argType = Field.class.getName();
				} else if (argName.equals("form")) {
					argType = Form.class.getName();
				} else if (argName.equals("account")) {
					argType = ResourceObject.class.getName();
				} else if (argName.equals("inputStream")) {
					argType = InputStream.class.getName();
				} else if (argName.equals("schema")) {
					argType = Schema.class.getName();
				} else if (argName.equals("sourceIdentityAttribute")) {
					argType = ObjectAttribute.class.getName();
				} else if (type.startsWith("JDBC") && argName.equals("connection")) {
					argType = Connection.class.getName();
				} else if (type.equals("Transformation") && argName.equals("object")) {
					argType = "Map<String, Object>";
				} else if (argName.equals("event")) {
					argType = TaskEvent.class.getName();
				} else if (argName.equals("taskResult")) {
					argType = TaskResult.class.getName();
				}
			} else if (argType.equalsIgnoreCase("string")) {
				argType = String.class.getName();
			} else if (argType.startsWith("List")) {
				argType = List.class.getName();
			} else if (argType.equals("Object")) {
				argType = Object.class.getName();
			} else if (argType.equals("ProvisioningPlan.AccountRequest")) {
				argType = ProvisioningPlan.AccountRequest.class.getCanonicalName();
			} else if (argType.equals("ProvisioningPlan.ObjectRequest")) {
				argType = ProvisioningPlan.ObjectRequest.class.getCanonicalName();
			} else if (argType.equals("ProvisioningPlan.AttributeRequest")) {
				argType = ProvisioningPlan.AttributeRequest.class.getCanonicalName();
			} else if (argType.equals("ProvisioningPlan.Operation")) {
				argType = ProvisioningPlan.Operation.class.getCanonicalName();
			} else {
				Class<?> cls = ObjectUtil.getSailPointClass(argType);
				if (cls != null) {
					argType = cls.getName();
				} else {
					argType = String.class.getName();
				}
			}
			if (Util.isNullOrEmpty(argType)) {
				argType = String.class.getName();
			}

			Objects.requireNonNull(variables).put(arg.getName(), argType);
		}
	}

	@SuppressWarnings("unchecked")
	private static void populateValuators(SailPointContext context, Map<String, Object> params, Map<String, DynamicValue> variableValuators, List<String> variableNames) throws GeneralException {
		List<Map<String, Object>> variables = (List<Map<String, Object>>) params.get(INPUT_VARIABLES);
		variables.sort(Comparator.comparingInt((map) -> (Util.otoi(map.get("index")))));

		for(Map<String, Object> var : variables) {
			boolean add = false;
			String name = Util.otoa(var.get("name"));
			if (Util.isNullOrEmpty(name)) {
				throw new IllegalArgumentException("Malformed input variable without a 'value' element");
			}
			String valueClassName = Util.otoa(var.get("type"));
			Map<String, Object> varValue = (Map<String, Object>) var.get(INPUT_VAR_VALUE);

			if (varValue != null) {
				String valueType = Util.otoa(varValue.get("valueType"));
				DynamicValue dynamicValue = new DynamicValue();
				if (valueType.equals(INPUT_VAR_TYPE_VALUE)) {
					if (Util.isNotNullOrEmpty(valueClassName)) {
						if (!(valueClassName.startsWith("java.") || valueClassName.startsWith("sailpoint."))) {
							throw new IllegalArgumentException("Unable to derive a value for the class " + valueClassName);
						}
						try {
							Class<?> valueClass = Class.forName(valueClassName);
							String value = Util.otoa(varValue.get("objectValue"));
							dynamicValue.setValue(deriveTypedValue(context, valueClass, value));
							add = true;
						} catch(Exception e) {
							throw new IllegalArgumentException(e);
						}
					}
				} else if (valueType.equals(INPUT_VAR_TYPE_OBJECT)) {
					String objectIdOrName = Util.otoa(varValue.get("objectName"));
					Class<? extends SailPointObject> spoClass = ObjectUtil.getSailPointClass(valueClassName);
					if (spoClass != null) {
						SailPointObject spo = context.getObject(spoClass, objectIdOrName);
						dynamicValue.setValue(spo);
						add = true;
					}
				} else if (valueType.equals(INPUT_VAR_TYPE_SCRIPT)) {
					if (Util.isNullOrEmpty(valueClassName)) {
						var.put("type", Object.class.getName());
					}

					Script script = Utilities.getAsScript(Util.otoa(varValue.get("objectScript")));
					dynamicValue.setScript(script);
					add = true;
				}
				if (add) {
					variableNames.add(name);
					variableValuators.put(name, dynamicValue);
				} else {
					variableValuators.put(name, null);
				}
			} else {
				throw new IllegalArgumentException("Malformed input variable without a 'value' element");
			}
		}
	}

	/**
	 * Web service endpoint to abort the given background thread. Thread termination is NOT
	 * guaranteed, but we will make a best effort to interrupt everything.
	 *
	 * @param jsonBody The JSON body of the POST request, which must contain the 'uuid' of a running rule
	 * @return The REST response
	 */
	@POST
	@Path("asyncAbort")
	@RequiredRight("IDW_SP_RuleRunner")
	@ResponsesAllowed(RunRuleOutcome.class)
	public Response asyncAbort(Map<String, Object> jsonBody) {
		return handle(() -> {
			String uuid = Util.otoa(jsonBody.get(VAR_UUID));
			if (Util.isNullOrEmpty(uuid)) {
				throw new IllegalArgumentException("Must supply a UUID in the JSON body");
			}
			RuleRunnerAsyncWorker worker = backgroundThreads.get(uuid);
			if (worker == null) {
				throw new IllegalArgumentException("No worker with UUID = " + uuid);
			}

			worker.abort();

			log.info("Waiting up to ten seconds for the worker to abort...");

			// Wait up to ten seconds for completion
			long timeout = System.currentTimeMillis() + (10 * 1000L);
			while(System.currentTimeMillis() < timeout && Util.isNotNullOrEmpty(worker.getKey())) {
				Thread.sleep(100);
			}

			String logLevel = Util.otoa(jsonBody.get("logLevel"));
			LogStreamWrapper.Level minLevel = null;
			if (Util.isNotNullOrEmpty(logLevel)) {
				minLevel = LogStreamWrapper.Level.valueOf(logLevel);
			}

			RunRuleOutcome outcome = new RunRuleOutcome();
			outcome.setStats(worker.taskMonitor.toMap());
			outcome.setAsync(true);
			outcome.setUuid(uuid);
			outcome.setLogs(worker.getLog().getMessages(minLevel));
			outcome.setElapsed(worker.getElapsedMillis());
			if (Util.isNullOrEmpty(worker.getKey())) {
				// This will only happen when the worker is done
				outcome.setTerminated(true);
				outcome.setOutput(transformResult(worker.getOutput()));
			} else {
				log.warn("Worker thread did not abort within ten seconds of asyncAbort being triggered");
			}

			return outcome;
		});
	}

    /**
     * Clears any uploaded file from the session
     * @return The REST response
     */
    @POST
    @Path("upload/clear")
    @Produces(MediaType.APPLICATION_JSON)
    @RequiredRight("IDW_SP_RuleRunner")
    public Response clearUploadedFile() {
        return handle(() -> {
            HttpSession session = request.getSession();
            session.removeAttribute(SESSION_UPLOADED_FILE_PATH);
            session.removeAttribute("IDW_RuleRunner_UploadedFileName");

            return Response.ok().build();
        });
    }

    @POST
    @Path("upload")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Produces(MediaType.APPLICATION_JSON)
    @RequiredRight("IDW_SP_RuleRunner")
    public Response fileUpload(@FormDataParam("file") File uploadFile, @FormDataParam("file") FormDataContentDisposition fileDisposition) {
        return handle(() -> {
            try {

                String filename = Util.isNotNullOrEmpty(fileDisposition.getFileName()) ? fileDisposition.getFileName() : uploadFile.getName();

                long size = uploadFile.length();
                if (size == 0) {
                    throw new IllegalArgumentException("Uploaded file is empty");
                } else if (size > 10 * 1024 * 1024) {
                    throw new IllegalArgumentException("Uploaded file exceeds the maximum allowed size of 10 MB");
                }

                String content = new String(Files.readAllBytes(uploadFile.toPath()), StandardCharsets.UTF_8);

                int lines = validateCsvInput(content);

                log.info("User {0} uploaded file {1} with {2} lines for Rule Runner", getLoggedInUserName(), filename, lines);

                AuditEvent ae = new AuditEvent();
                ae.setAction(AUDIT_FILE_UPLOAD_PLUGIN_ACTION);
                ae.setSource(getLoggedInUserName());
                ae.setTarget(Util.truncateFront(filename, 255));
                ae.setAttribute("lines", lines);
                ae.setAttribute(AUDIT_HOST, Util.getHostName());
                ae.setAttribute(AUDIT_CLIENT, Utils.getRemoteIp(request));

                try {
                    // Copy the file to a more persistent temp location
                    File tempDir = new File(System.getProperty("java.io.tmpdir"), "ruleRunnerUploads");
                    if (!tempDir.exists()) {
                        boolean worked = tempDir.mkdirs();
                        if (!worked) {
                            throw new IOException("Unable to create temp directory for rule runner uploads: " + tempDir.getAbsolutePath());
                        }
                    }

                    File tempFile = new File(tempDir, System.currentTimeMillis() + "_" + filename);

                    ae.setAttribute("tempFilePath", tempFile.getAbsolutePath());

                    Files.write(tempFile.toPath(), content.getBytes(StandardCharsets.UTF_8));

                    ae.setAttribute("tempFileSize", tempFile.length());

                    request.getSession().setAttribute("IDW_RuleRunner_UploadedFileName", filename);
                    request.getSession().setAttribute(SESSION_UPLOADED_FILE_PATH, tempFile.getAbsolutePath());

                    String sizeStr;
                    if (size < 1024) {
                        sizeStr = size + " bytes";
                    } else if (size < (1024 * 1024)) {
                        sizeStr = String.format("%.2f KB", (size / 1024.0));
                    } else {
                        sizeStr = String.format("%.2f MB", (size / (1024.0 * 1024.0)));
                    }

                    Map<String, Object> responseMap = new HashMap<>();
                    responseMap.put("fileName", filename);
                    responseMap.put("size", sizeStr);
                    responseMap.put("lines", lines);
                    responseMap.put("ok", true);

                    return responseMap;
                } finally {
                    Utilities.withPrivateContext((privateContext) -> {
                        privateContext.saveObject(ae);
                        privateContext.commitTransaction();
                    });
                }

            } catch(IOException e) {
                log.error("Caught an error uploading a file for rule runner", e);
                throw new GeneralException("Unable to upload file", e);
            }
        });
    }

    /**
     * Validates the CSV input is well-formed and returns the number of lines. Since
     * CSV lines can contain embedded newlines, we have to actually parse the CSV to
     * count the lines.
     *
     * @param content The CSV content
     * @return The number of lines
     * @throws IOException if an error occurs reading the content
     */
    private static int validateCsvInput(String content) throws IOException {
        int lines = 0;

        // Validate CSV content
        try (BufferedReader reader = new BufferedReader(new StringReader(content))) {
            RFC4180LineIterator iterator = new RFC4180LineIterator(reader);
            try {
                RFC4180LineParser parser = new RFC4180LineParser(',');
                parser.tolerateMissingColumns(true);
                String line;
                while ((line = iterator.readLine()) != null) {
                    parser.parseLine(line);
                    lines++;
                }
            } catch(IOException | GeneralException e) {
                throw new IllegalArgumentException("Uploaded file is not valid CSV: " + e.getMessage(), e);
            }
        }
        return lines;
    }

    /**
	 * Gets the list of available rule types
	 * @return The list of available rule types
	 */
	@GET
	@Path("types")
	@RequiredRight("IDW_SP_RuleRunner")
	public Response getAllRuleTypes() {
		return handle(() -> {
			List<String> types = new ArrayList<>(Utilities.safeStream(Arrays.asList(Rule.Type.values())).map(Enum::name).collect(Collectors.toList()));
			types.add("");
			types.sort(Comparator.naturalOrder());
			return types;
		});
	}
	
	/**
	 * Gets the list of available rule libraries
	 * @param search A partial search, optionally
	 * @return The list of available rule libraries
	 */
	@GET
	@Path("list")
	@RequiredRight("IDW_SP_RuleRunner")
	public Response getAllRules(@QueryParam("search") final String search) {
		return handle(() -> {
			final Map<String, String> ruleTypes = new HashMap<>();
			List<Rule> allRules = getContext().getObjects(Rule.class);
			allRules.forEach(rule -> {
				if (Util.isNullOrEmpty(search) || rule.getName().contains(search)) {
					String type = "";
					if (rule.getType() != null) {
						type = rule.getType().name();
					}
					ruleTypes.put(rule.getName(), type);
				}
			});
			return Response.ok().entity(ruleTypes).build();
		});
	}
	
	@GET
	@Path("asyncUpdate")
	@RequiredRight("IDW_SP_RuleRunner")
	@ResponsesAllowed(RunRuleOutcome.class)
	public Response getAsyncUpdate(@QueryParam(VAR_UUID) String uuid, @QueryParam("logLevel") String logLevel) {
		return handle(() -> {
			if (Util.isNullOrEmpty(uuid)) {
				throw new IllegalArgumentException("Must supply a UUID as a query parameter");
			}
			RuleRunnerAsyncWorker worker = backgroundThreads.get(uuid);
			if (worker == null) {
				throw new IllegalArgumentException("No worker with UUID = " + uuid);
			}

			RunRuleOutcome response = new RunRuleOutcome();
			LogStreamWrapper.Level minLevel = null;
			if (Util.isNotNullOrEmpty(logLevel)) {
				minLevel = LogStreamWrapper.Level.valueOf(logLevel);
			}
			response.setElapsed(worker.getElapsedMillis());
			response.setStats(worker.taskMonitor.toMap());
			response.setUuid(uuid);
			response.setLogs(worker.getLog().getMessages(minLevel));
			if (Util.isNullOrEmpty(worker.getKey())) {
				// This will only happen when the worker is done
				response.setOutput(transformResult(worker.getOutput()));
				response.setTerminated(true);
			}

			return response;
		});
	}

	/**
	 * Returns the audited history of the logged-in user
	 * @return The audited history
	 */
	@GET
	@Path("history")
	@RequiredRight("IDW_SP_RuleRunner")
	@ResponsesAllowed(HistoryEntry.class)
	public Response getMyRuleHistory() {
		return handle(() -> {
			QueryOptions qo = new QueryOptions();
			qo.addFilter(Filter.eq("target", AUDIT_TARGET));
			qo.addFilter(Filter.eq(INPUT_SOURCE, getLoggedInUserName()));
			qo.addFilter(Filter.eq("action", AUDIT_RUN_RULE_PLUGIN_ACTION));

			List<HistoryEntry> history = new ArrayList<>();
			IncrementalObjectIterator<AuditEvent> auditEvents = new IncrementalObjectIterator<>(getContext(), AuditEvent.class, qo);
			while(auditEvents.hasNext()) {
				AuditEvent ae = auditEvents.next();
				history.add(new HistoryEntry(ae));
			}

			return history;
 		});
	}

	@Override
	public String getPluginName() {
		return "IDWRuleRunnerPlugin";
	}

	/**
	 * Gets full information about some rule
	 * @param ruleName The name of the rule to retrieve
	 * @return The list of available rule libraries
	 */
	@GET
	@Path("load")
	@RequiredRight("IDW_SP_RuleRunner")
	public Response getRuleInformation(@QueryParam("name") final String ruleName) {
		return handle(() -> {
			if (Util.isNullOrEmpty(ruleName)) {
				throw new IllegalArgumentException("Name must not be null");
			}
			Rule theRule = getContext().getObjectByName(Rule.class, ruleName);
			if (theRule == null) {
				throw new NotFoundException();
			}
			return new RuleInformation(theRule);
		});
	}

	/**
	 * Gets the list of available rule libraries
	 * @param search A partial search, optionally
	 * @return The list of available rule libraries
	 */
	@GET
	@Path("rl")
	@RequiredRight("IDW_SP_RuleRunner")
	public Response getRuleLibraries(@QueryParam("search") String search) {
		return handle(() -> {
			Set<String> ruleLibraries = new HashSet<>();
			List<Rule> allRules = getContext().getObjects(Rule.class);
			for(Rule r : allRules) {
				if (r.getType() == null) {
					ruleLibraries.add(r.getName());
				}
				if (r.getReferencedRules() != null) {
					for(Rule ref : r.getReferencedRules()) {
						ruleLibraries.add(ref.getName());
					}
				}
			}
			List<String> result = new ArrayList<>();
			for(String option : ruleLibraries) {
				if (search == null || search.isEmpty() || option.toUpperCase().startsWith(search.toUpperCase())) {
					result.add(option);
				}
			}
			Collections.sort(result);
			return Response.ok().entity(result).build();
		});
	}

	/**
	 * Gets the list of available rule types
	 * @return The list of available rule types
	 */
	@GET
	@Path("signature/{type}")
	@RequiredRight("IDW_SP_RuleRunner")
	public Response getRuleSignature(@PathParam("type") String type) {
		return handle(() -> {
			Map<String, Object> variables = new HashMap<>();
			RuleRegistry registry = RuleRegistry.getInstance(getContext());
			Rule ruleTemplate = registry.getTemplate(type);

			if (ruleTemplate != null) {
				Signature signature = ruleTemplate.getSignature();
				if (signature != null) {
					populateArguments(signature, type, variables);
				}
			} else {
				log.warn("Rule type " + type + " does not have a signature defined");
			}
			return variables;
		});
	}

    /**
     * Handles CSV input if specified in the parameters. This allows users to upload
     * CSV files and iterate through them in code, etc. The CSV data is made available
     * in the 'csvData' variable, which is a List of Maps. If the CSV has headers,
     * the Map keys will be the header names; otherwise, the keys will be the column
     * indexes (0-based).
     *
     * The 'csvHeaders' variable is also populated with the list of headers, or null
     * if the CSV has no headers.
     *
     * @param httpPostBody The input parameters
     * @param ruleInputs The rule inputs map to populate
     * @throws IOException If an error occurs reading the uploaded file
     * @throws GeneralException If any other error occurs
     */
    private void handleCsvInput(Map<String, Object> httpPostBody, Map<String, Object> ruleInputs) throws IOException, GeneralException {
        String filename = Util.otoa(request.getSession().getAttribute(SESSION_UPLOADED_FILE_PATH));
        boolean csvHasHeader = Util.otob(httpPostBody.get("csvHasHeaders"));
        boolean csvErrorOnShortLines = Util.otob(httpPostBody.get("csvErrorOnShortLines"));
        if (Util.isNotNullOrEmpty(filename)) {
            File csvFile = new File(filename);
            if (!csvFile.exists()) {
                throw new IllegalArgumentException("Uploaded CSV file not found: " + csvFile.getName());
            }

            if (!csvFile.canRead()) {
                throw new IllegalArgumentException("Uploaded CSV file is not readable: " + csvFile.getName());
            }

            String csvContent = new String(Files.readAllBytes(csvFile.toPath()), StandardCharsets.UTF_8);
            log.info("Processing uploaded CSV file {0} with size {1} bytes", csvFile.getName(), csvFile.length());
            List<Map<?, String>> csvData = new ArrayList<>();
            try (BufferedReader reader = new BufferedReader(new StringReader(csvContent))) {
                RFC4180LineParser lineParser = new RFC4180LineParser(',');
                RFC4180LineIterator iterator = new RFC4180LineIterator(reader);
                try {
                    List<String> headers = null;
                    if (csvHasHeader) {
                        String firstLine = iterator.readLine();
                        if (firstLine == null) {
                            throw new IllegalArgumentException("Uploaded CSV file is empty: " + csvFile.getName());
                        }
                        headers = lineParser.parseLine(firstLine);
                        ruleInputs.put(VAR_CSV_HEADERS, headers);
                    } else {
                        ruleInputs.put(VAR_CSV_HEADERS, null);
                    }
                    String line;
                    while((line = iterator.readLine()) != null) {
                        List<String> values = lineParser.parseLine(line);
                        if (csvErrorOnShortLines && csvHasHeader && values.size() < headers.size()) {
                            throw new IllegalArgumentException("CSV line has fewer columns (" + values.size() + ") than header (" + headers.size() + "): " + line);
                        }
                        Map<Object, String> row = new HashMap<>();
                        if (csvHasHeader) {
                            for(int i = 0; i < headers.size(); i++) {
                                String value = (i < values.size()) ? values.get(i) : "";
                                row.put(headers.get(i), value);
                            }
                        } else {
                            for(int i = 0; i < values.size(); i++) {
                                row.put(i, values.get(i));
                            }
                        }
                        csvData.add(row);
                    }
                    ruleInputs.put(VAR_CSV_DATA, csvData);
                } finally {
                    iterator.close();
                }
            }
        }
    }

	@POST
	@Path("parse")
	@RequiredRight("IDW_SP_RuleRunner")
	public Response parse(Map<String, Object> params) {
		return handle(() -> {
			String script = (String) params.get(INPUT_SCRIPT);
			List<String> librarySources = new ArrayList<>();
			if (params.get(INPUT_LIBRARIES) instanceof Map) {
				@SuppressWarnings("unchecked")
				List<Map<String, String>> libraries = (List<Map<String, String>>) params.get(INPUT_LIBRARIES);
				if (libraries != null) {
					for (Map<String, String> lib : libraries) {
						String libName = lib.get(INPUT_LIBRARY_TITLE);
						Rule libRule = getContext().getObjectByName(Rule.class, libName);
						librarySources.add(libRule.getSource());
					}
				}
			}
			boolean includeWebClasses = Util.otob(params.get(INPUT_INCLUDE_WEB_CLASSES));
			BeanshellSyntaxChecker checker = new BeanshellSyntaxChecker(script, librarySources, log);
			checker.addExpectedVariable(VAR_UUID, String.class);
			checker.addExpectedVariable(VAR_MONITOR, Monitor.class);
			checker.addExpectedVariable("__worker", SailPointWorker.class);
			if (includeWebClasses) {
				checker.addExpectedVariable(VAR_WEB_SERVICE, BasePluginResource.class);
				checker.addExpectedVariable(VAR_HTTP_REQUEST, HttpServletRequest.class);
				checker.addExpectedVariable(VAR_HTTP_RESPONSE, HttpServletResponse.class);
			}
			boolean isWorkflowRuleLibrary = Util.otob(params.get("isWorkflowRuleLibrary"));
			if (isWorkflowRuleLibrary) {
				checker.addExpectedVariable("launcher", String.class);
				checker.addExpectedVariable("wfcontext", WorkflowContext.class);
			}
			checker.setSuppressRawTypeErrors(Util.otob(params.get("suppressRawTypeErrors")));
			if (params.containsKey(INPUT_VARIABLES) && params.get(INPUT_VARIABLES) instanceof List) {
				List<Map<String, Object>> variables = (List<Map<String, Object>>) params.get(INPUT_VARIABLES);
				for(Map<String, Object> variable : variables) {
					String name = Util.otoa(variable.get("name"));
					String type = Util.otoa(variable.get("type"));
					if (Util.isNullOrEmpty(type)) {
						type = "Object";
					}
					checker.addExpectedVariable(name, type);
				}
			}
            String uploadedFilePath = Util.otoa(request.getSession().getAttribute(SESSION_UPLOADED_FILE_PATH));
            if (Util.isNotNullOrEmpty(uploadedFilePath)) {
                checker.addExpectedVariable(VAR_CSV_DATA, List.class);
                checker.addExpectedVariable(VAR_CSV_HEADERS, List.class);
            }
			return checker.parse();
		});
	}

	@SuppressWarnings("unchecked")
	@POST
	@Path("run")
	@RequiredRight("IDW_SP_RuleRunner")
	@ResponsesAllowed(RunRuleOutcome.class)
	public Response run(Map<String, Object> params) {
		return handle(() -> {
			RunRuleOutcome response = new RunRuleOutcome();
			try {
				boolean async = false;
				int ruleTimeout = 10;
				if (params.containsKey(INPUT_ASYNC) && params.get(INPUT_ASYNC) != null) {
					if (params.get(INPUT_ASYNC) instanceof String) {
						async = Boolean.parseBoolean((String)params.get(INPUT_ASYNC));
					} else if (params.get(INPUT_ASYNC) instanceof Boolean) {
						async = (Boolean)params.get(INPUT_ASYNC);
					} else {
						throw new IllegalArgumentException("Async must be a string or boolean value");
					}
				}
				// Grab desired timeout if present in UI
				if (params.containsKey(INPUT_RULE_TIMEOUT) && Util.isNotNullOrEmpty(Util.otoa(params.get(INPUT_RULE_TIMEOUT)))) {
					if (params.get(INPUT_RULE_TIMEOUT) instanceof String) {
						log.debug(params.get(INPUT_RULE_TIMEOUT));
						try {
							ruleTimeout = Integer.parseInt((String)params.get(INPUT_RULE_TIMEOUT));
							log.debug("Custom timeout detected, setting value: " + ruleTimeout);
						}
						catch(Exception e) {
							log.warn("Issue converting value in text field to int.");
							log.warn(e);
						}
					} else {
						log.warn("Issue assigning custom timeout time, defaulting to 10 min");
						log.warn(params.get(INPUT_RULE_TIMEOUT));
					}
				}

				boolean includeWebClasses = Util.otob(params.get(INPUT_INCLUDE_WEB_CLASSES));

				// Abort on bad input as soon as possible
				if (async && includeWebClasses) {
					throw new IllegalArgumentException("Cannot execute both async and with web classes");
				}

				Rule fakeRule = new Rule();
				fakeRule.setLanguage(LANGUAGE_BEANSHELL);
				fakeRule.setSource(addInterrupts((String) params.get(INPUT_SCRIPT)));
				fakeRule.setName(FAKE_RULE_PREFIX + System.currentTimeMillis());
				List<Rule> referencedRules = new ArrayList<Rule>();

				if (params.containsKey(INPUT_LIBRARIES) && params.get(INPUT_LIBRARIES) instanceof List) {
					for(Map<String, String> library : ((List<Map<String, String>>)params.get(INPUT_LIBRARIES))) {
						String name = library.get(INPUT_LIBRARY_TITLE);
						Rule rule = getContext().getObjectByName(Rule.class, name);
						if (rule != null) {
							referencedRules.add(rule);
						}
					}
					fakeRule.setReferencedRules(referencedRules);
				}

				if (log.isDebugEnabled()) {
					log.debug("Rule XML: {0}", fakeRule.toXml());
				}

				Map<String, Object> inputs = new HashMap<>();
				if (params.get(INPUT_VARIABLES) instanceof List) {
					Map<String, DynamicValue> variableValuators = new HashMap<>();
					List<String> variableNames = new ArrayList<>();
					populateValuators(getContext(), params, variableValuators, variableNames);

					if (log.isDebugEnabled()) {
						log.debug("Evaluating dynamic variable values: " + variableNames);
					}

					for(String name : variableNames) {
						if (name.equals(VAR_LOG) || name.equals(VAR_CONTEXT) || name.equals(VAR_MONITOR) || name.equals(VAR_LOG1)) {
							continue;
						}
						DynamicValue dynamicValue = variableValuators.get(name);
						if (dynamicValue != null) {
							DynamicValuator valuator = new DynamicValuator(dynamicValue);
							Object result = valuator.evaluate(getContext(), inputs);
							inputs.put(name, result);
						} else {
							inputs.put(name, null);
						}
					}
				}

                handleCsvInput(params, inputs);

                String randomCode = UUID.randomUUID().toString();

				final boolean finalAsync = async;
				Utilities.withPrivateContext((privateContext) -> {
					AuditEvent auditEvent = new AuditEvent();
					auditEvent.setSource(super.getLoggedInUser().getName());
					auditEvent.setAction(AUDIT_RUN_RULE_PLUGIN_ACTION);
					auditEvent.setTarget(AUDIT_TARGET);
					auditEvent.setAttribute(VAR_UUID, randomCode);
					// TODO - clean up secrets in the source code, particularly .encrypt and .decrypt
					auditEvent.setAttribute(AUDIT_CODE, fakeRule.getSource());
					auditEvent.setAttribute(AUDIT_LIBRARIES, ObjectUtil.getObjectNames(referencedRules));
					auditEvent.setAttribute(AUDIT_ASYNC, finalAsync);
					auditEvent.setAttribute(AUDIT_INCLUDE_WEB_CLASSES, includeWebClasses);
					auditEvent.setAttribute(AUDIT_INPUT_VARIABLES, inputs.keySet());
					auditEvent.setAttribute(AUDIT_HOST, Util.getHostName());
					auditEvent.setAttribute(AUDIT_CLIENT, Utils.getRemoteIp(request));

					if (Auditor.isEnabled(AUDIT_RUN_RULE_PLUGIN_ACTION)) {
						privateContext.saveObject(auditEvent);
						privateContext.commitTransaction();
					}

					// Ideally, you would use log4j2 config to route this to syslog or similar
					Utils.SYSTEM_LOG.debug(auditEvent.toXml());
				});

                // The actual parameters to the rule, passed as variables
				Map<String, Object> parameters = new HashMap<>(inputs);
				parameters.put(VAR_UUID, randomCode);

				if (async) {
					final Log log = LogFactory.getLog(RuleRunnerAsyncWorker.class);
					final LogStreamWrapper wrappedLog = new LogStreamWrapper(log);
					RuleRunnerAsyncWorker backgroundWorker = new RuleRunnerAsyncWorker(fakeRule, parameters, wrappedLog, getSettingBool("createTaskResult"), getLoggedInUserName());
					Thread backgroundThread = new Thread(backgroundWorker);
					backgroundThread.setDaemon(true);
					backgroundThread.setName(RULE_RUNNER_BACKGROUND_THREAD + backgroundWorker.getKey());
					if (log.isDebugEnabled()) {
						log.debug("Starting background thread " + backgroundThread.getName());
					}
					backgroundThread.start();
					RuleRunnerMonitorThread monitorThread = new RuleRunnerMonitorThread(backgroundThread, backgroundWorker, wrappedLog, ruleTimeout, TimeUnit.MINUTES);
					monitorThread.start();
					if (log.isDebugEnabled()) {
						log.debug("Starting monitor thread " + monitorThread.getName());
					}
					backgroundWorker.setMonitorThread(monitorThread);

					backgroundThreads.put(randomCode, backgroundWorker);
					log.warn("Started Rule Runner worker and monitor threads with worker UUID " + randomCode);


					// Up to 3 seconds to allow a synchronous response
					backgroundThread.join(3000L);
					if (!backgroundThread.isAlive()) {
						if (log.isDebugEnabled()) {
							log.debug("Rule finished within 3 seconds; returning synchronously");
						}
						// Finished up within the 3 second window
						Object result = backgroundThreads.get(randomCode).getOutput();
						response.setAsync(false);
						response.setOutput(transformResult(result));
					} else {
						response.setAsync(true);
					}
					response.setElapsed(backgroundWorker.getElapsedMillis());
					response.setUuid(randomCode);
					response.setLogs(wrappedLog.getMessages(LogStreamWrapper.Level.Debug));
					response.setStats(backgroundThreads.get(randomCode).taskMonitor.toMap());
				} else {
					if (includeWebClasses) {
						parameters.put(VAR_WEB_SERVICE, this);
						parameters.put(VAR_HTTP_REQUEST, request);
						parameters.put(VAR_HTTP_RESPONSE, response);
					}
					RuleRunnerTaskMonitor monitor = new RuleRunnerTaskMonitor();
					LogStreamWrapper wrappedLog = new LogStreamWrapper(log);
					parameters.put(VAR_LOG, wrappedLog);
					parameters.put(VAR_LOG1, wrappedLog);
					parameters.put(VAR_LOG2, wrappedLog);
					parameters.put(VAR_MONITOR, monitor);
					Object result = getContext().runRule(fakeRule, parameters);
					response.setStats(new HashMap<>());
					response.setAsync(false);
					response.setUuid(randomCode);
					response.setOutput(transformResult(result));
					response.setLogs(wrappedLog.getMessages(LogStreamWrapper.Level.Debug));
				}
			} catch(Throwable e) {
				response.setOutput(transformResult(e));
				response.setError(true);
			}
			return response;
		});
	}

    @POST
	@Path("save")
	@RequiredRight("IDW_SP_RuleRunner")
	public Response saveRuleInformation(Map<String, Object> params) {
		return handle(() -> {
			if (params == null || params.isEmpty()) {
				throw new IllegalArgumentException("Save requires a JSON object as a parameter");
			}
			String id = Util.otoa(params.get("id"));
			String name = Util.otoa(params.get("name"));
			if (Util.isNullOrEmpty(id) && Util.isNullOrEmpty(name)) {
				throw new IllegalArgumentException("An 'id' or a 'name' must be specified to save the rule");
			}
			String source = Util.otoa(params.get(INPUT_SOURCE));
			if (Util.isNullOrEmpty(source) || source.trim().isEmpty()) {
				throw new IllegalArgumentException("The rule source must not be blank");
			}
			List<String> libraries = new ArrayList<>();
			if (params.containsKey(INPUT_LIBRARIES) && params.get(INPUT_LIBRARIES) instanceof List) {
				libraries = Util.otol(params.get(INPUT_LIBRARIES));
			}
			String type = Util.otoa(params.get("type"));
			Rule.Type parsedType = null;
			if (Util.isNotNullOrEmpty(type)) {
				parsedType = Rule.Type.valueOf(type);
			}

			String description = (String)params.get("description");

			Rule ruleObject = null;
			if (Util.isNotNullOrEmpty(id)) {
				ruleObject = getContext().getObjectById(Rule.class, id);
			} else if (Util.isNotNullOrEmpty(name)) {
				ruleObject = getContext().getObjectByName(Rule.class, name);
			}

			if (ruleObject == null) {
				ruleObject = new Rule();

				if (parsedType != null && ruleObject.getSignature() == null) {
					RuleRegistry registry = RuleRegistry.getInstance(getContext());
					Rule templateRule = registry.getTemplate(parsedType);
					if (templateRule.getSignature() != null) {
						ruleObject.setSignature((Signature) templateRule.getSignature().deepCopy(getContext()));
					}
				}
			}
			if (description != null) {
				if (ruleObject.getSignature() == null) {
					ruleObject.setSignature(new Signature());
				}
				ruleObject.getSignature().setDescription(description);
			}
			ruleObject.setName(name);
			ruleObject.setSource(source);
			ruleObject.setLanguage(LANGUAGE_BEANSHELL);
			ruleObject.setType(parsedType);
			if (libraries != null) {
				List<Rule> ruleLibraryList = new ArrayList<>();
				for(String library : libraries) {
					Rule ruleLibrary = getContext().getObjectByName(Rule.class, library);
					if (ruleLibrary != null) {
						ruleLibraryList.add(ruleLibrary);
					}
				}
				ruleObject.setReferencedRules(ruleLibraryList);
			}
			getContext().saveObject(ruleObject);
			getContext().commitTransaction();

			return getRuleInformation(name);
		});
	}

	private Map<String, Object> transformResult(Object result) throws GeneralException {
		Map<String, Object> resultMap = new HashMap<>();
		if (result == null) {
			resultMap.put("isNull", true);
		} else if (result instanceof Custom || result instanceof Map) {
			// These types are both instances of Map and will be serialized as such,
			// so we can return it directly
			resultMap.put(OUTPUT_VALUE, new TreeMap((Map)result));
			resultMap.put(OUTPUT_TYPE, result.getClass().getName());
		} else if (result instanceof SailPointObject) {
			SailPointObject spo = (SailPointObject)result;
			resultMap.put(OUTPUT_VALUE, spo.toXml());
			resultMap.put(OUTPUT_TYPE, spo.getClass().getName());
			resultMap.put("id", spo.getId());
			resultMap.put("name", spo.getName());
		} else if (result instanceof Throwable) {
			Throwable t = (Throwable) result;
			Map<String, Object> responseMap = new HashMap<>();
			responseMap.put("exception", t.getClass().getName());
			responseMap.put("message", getExceptionString(t));
			responseMap.put("quickKey", SyslogThreadLocal.get());
			if (t.getCause() != null) {
				responseMap.put("parentException", t.getCause().getClass().getName());
				responseMap.put("parentMessage", t.getCause().getMessage());
			}
			resultMap.put("exception", responseMap);
		} else if (result instanceof Collection) {
			resultMap.put(OUTPUT_TYPE, result.getClass().getName());
			List<Object> outputs = new ArrayList<>();
			for(Object val : ((Collection)result)) {
				if (val instanceof SailPointObject) {
                    SailPointObject spo = (SailPointObject) val;
                    Map<String, Object> spoMap = new TreeMap<>();
                    spoMap.put(OUTPUT_TYPE, spo.getClass().getName());
                    spoMap.put("id", spo.getId());
                    spoMap.put("name", spo.getName());
                    if (spo instanceof Link) {
                        Link l = (Link) spo;
                        spoMap.put("nativeIdentity", l.getNativeIdentity());
                        spoMap.put("application", l.getApplicationName());
                        spoMap.put("identity", l.getIdentity() == null ? null : l.getIdentity().getName());
                        spoMap.put("disabled", l.isDisabled());
                        spoMap.put("locked", l.isLocked());
                    } else if (spo instanceof Identity) {
                        Identity i = (Identity) spo;
                        spoMap.put("displayName", i.getDisplayName());
                        spoMap.put("inactive", i.isInactive());
                        spoMap.put("workgroup", i.isWorkgroup());
                        spoMap.put("correlated", i.isCorrelated());
                        spoMap.put("lastRefresh", i.getLastRefresh() == null ? null : i.getLastRefresh().toString());
                        spoMap.put("assignedRoles", Utilities.safeStream(i.getActiveRoleAssignments()).map(RoleAssignment::getRoleName).collect(Collectors.toList()));
                        spoMap.put("links", Utilities.safeStream(i.getLinks()).map(l -> l.getApplicationName() + " " + l.getNativeIdentity() + " (" + (l.isDisabled() ? "disabled" : "enabled") + ")").collect(Collectors.toList()));
                    }
                    outputs.add(spoMap);
                } else if (val instanceof Collection || val instanceof Map) {
                    Map<String, Object> transformedItem = transformResult(val);
                    if (transformedItem == null) {
                        outputs.add(null);
                    } else {
                        outputs.add(transformedItem.get(OUTPUT_VALUE));
                    }
				} else if (val == null) {
					outputs.add(null);
				} else {
					outputs.add(String.valueOf(val));
				}
			}
			resultMap.put(OUTPUT_VALUE, outputs);
		} else {
			resultMap.put(OUTPUT_TYPE, result.getClass().getName());
			resultMap.put(OUTPUT_VALUE, result.toString());
		}
		return resultMap;
	}

}
