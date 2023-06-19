package com.identityworksllc.iiq.plugins.rrp;

import com.identityworksllc.iiq.common.minimal.Functions;
import com.identityworksllc.iiq.common.minimal.Utilities;
import com.identityworksllc.iiq.common.minimal.plugin.BaseCommonPluginResource;
import com.identityworksllc.iiq.common.minimal.threads.SailPointWorker;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import sailpoint.api.DynamicValuator;
import sailpoint.api.IncrementalObjectIterator;
import sailpoint.api.ObjectUtil;
import sailpoint.api.SailPointContext;
import sailpoint.api.logging.SyslogThreadLocal;
import sailpoint.object.*;
import sailpoint.rest.plugin.BasePluginResource;
import sailpoint.rest.plugin.RequiredRight;
import sailpoint.server.Auditor;
import sailpoint.tools.GeneralException;
import sailpoint.tools.Util;
import sailpoint.tools.xml.AbstractXmlObject;
import sailpoint.workflow.WorkflowContext;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.ws.rs.GET;
import javax.ws.rs.NotFoundException;
import javax.ws.rs.POST;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.QueryParam;
import javax.ws.rs.core.Response;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.io.Reader;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.text.CharacterIterator;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.text.StringCharacterIterator;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Collectors;

@Path("IDWRuleRunnerPlugin")
public class RuleRunnerResource extends BaseCommonPluginResource {

	private static class RuleRunnerMonitorThread extends Thread {
		private final AtomicBoolean abort;
		private final Thread backgroundThread;
		private final Log log;
		private final long timeout;
		private final long timeoutTimestamp;
		private final TimeUnit timeoutUnit;

		public RuleRunnerMonitorThread(Thread backgroundThread, long timeout, TimeUnit timeoutUnit) {
			super.setPriority(3);
			super.setName(this.getClass() + " - " + (System.currentTimeMillis() / 1000));
			super.setDaemon(true);

			this.abort = new AtomicBoolean();
			this.backgroundThread = backgroundThread;
			this.timeout = timeout;
			this.timeoutUnit = timeoutUnit;

			this.timeoutTimestamp = System.currentTimeMillis() + TimeUnit.MILLISECONDS.convert(timeout, timeoutUnit);

			this.log = LogFactory.getLog(this.getClass());
		}

		public void abort() {
			this.abort.set(true);
		}

		@Override
		public void run() {
			try {
				// Initial sleep to give the background thread time to start
				Thread.sleep(10000L);
				while (System.currentTimeMillis() < timeoutTimestamp && backgroundThread.isAlive() && !abort.get()) {
					Thread.sleep(1000L);
				}
				if (backgroundThread.isAlive()) {
					log.warn("The background thread " + backgroundThread.getName() + " has timed out; we are interrupting it now");
					backgroundThread.interrupt();
					for(int attempts = 0; attempts < 10; attempts++) {
						backgroundThread.join(10 * 1000L);
						if (backgroundThread.isAlive()) {
							log.info("Waiting for background thread " + backgroundThread.getName() + " to terminate...");
						}
					}
					if (backgroundThread.isAlive()) {
						log.error("Could not terminate background thread " + backgroundThread.getName() + "! It is likely dangling and may cause performance problems!");
					}
				} else {
					log.info("The background rule runner thread terminated normally");
				}
			} catch(InterruptedException e) {
				log.warn("Monitor thread interrupted; interrupting monitored worker thread");
				if (backgroundThread.isAlive()) {
					backgroundThread.interrupt();
				}
			} catch(Exception e) {
				log.error("Caught an exception waiting for the background thread", e);
			}
		}
	}

	private static class RuleRunnerBackgroundThread extends SailPointWorker {
		private String key;
		private final LogStreamWrapper log;
		private RuleRunnerMonitorThread monitor;
		private Object output;
		private final Map<String, Object> params;
		private final Rule rule;
		private final RuleRunnerTaskMonitor taskMonitor;

		public RuleRunnerBackgroundThread(Rule rule, Map<String, Object> params, LogStreamWrapper log) {
			this.rule = rule;
			this.params = new HashMap<>(params);
			this.log = log;
			this.key = Util.otoa(this.params.get("uuid"));
			if (Util.isNullOrEmpty(this.key)) {
				this.key = UUID.randomUUID().toString();
			}
			this.taskMonitor = new RuleRunnerTaskMonitor();
		}

		public void abort() {
			if (this.monitor != null) {
				this.monitor.abort();
			}
		}

		@Override
		public Object execute(SailPointContext context, Log log) throws Exception {
			try {
				if (!params.containsKey("log")) {
					params.put("log", this.log);
				}
				if (!params.containsKey("_log")) {
					params.put("_log", this.log);
				}
				params.put("monitor", this.taskMonitor);
				params.put("uuid", key);
				output = context.runRule(rule, params);
			} catch(Exception e) {
				output = e;
			} finally {
				// Allow this thread to be collected
				this.key = null;
				this.monitor = null;
			}

			return null;
		}

		public String getKey() {
			return key;
		}

		public LogStreamWrapper getLog() {
			return log;
		}

		public RuleRunnerMonitorThread getMonitor() {
			return monitor;
		}

		public Object getOutput() {
			return output;
		}

		public RuleRunnerTaskMonitor getTaskMonitor() {
			return taskMonitor;
		}

		public void setMonitor(RuleRunnerMonitorThread monitorThread) {
			this.monitor = monitorThread;
		}
	}

	protected static final String RUN_RULE_PLUGIN_ACTION = "runRulePluginAction";

	/**
	 * Background threads
	 */
	private static final Map<String, RuleRunnerBackgroundThread> backgroundThreads = new WeakHashMap<>();

	/**
	 * Modify the code by adding interrupts to it at the start of every code block
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
				escaped = true;
			} else if (c == '{' && !inQuotes) {
				if (isSwitch) {
					isSwitch = false;
				} else {
					newSource.append(" if (Thread.currentThread().isInterrupted()) { throw new InterruptedException(); } ");
				}
				escaped = false;
			} else {
				escaped = false;
			}
		}
		return newSource.toString();
	}
	
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

	private static String getExceptionString(Throwable e) {
		try (ByteArrayOutputStream baos = new ByteArrayOutputStream(); PrintStream stream = new PrintStream(baos)) {
			e.printStackTrace(stream);
			return baos.toString("UTF-8");
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
			if (Util.isNullOrEmpty(argName) || argName.equals("context") || argName.equals("log")) {
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
		List<Map<String, Object>> variables = (List<Map<String, Object>>) params.get("variables");
		variables.sort(Comparator.comparingInt((map) -> (Util.otoi(map.get("index")))));

		for(Map<String, Object> var : variables) {
			boolean add = false;
			String name = Util.otoa(var.get("name"));
			if (Util.isNullOrEmpty(name)) {
				throw new IllegalArgumentException("Malformed input variable without a 'value' element");
			}
			String valueClassName = Util.otoa(var.get("type"));
			Map<String, Object> varValue = (Map<String, Object>) var.get("value");

			if (varValue != null) {
				String valueType = Util.otoa(varValue.get("valueType"));
				DynamicValue dynamicValue = new DynamicValue();
				if (valueType.equals("value")) {
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
				} else if (valueType.equals("object")) {
					String objectIdOrName = Util.otoa(varValue.get("objectName"));
					Class<? extends SailPointObject> spoClass = ObjectUtil.getSailPointClass(valueClassName);
					if (spoClass != null) {
						SailPointObject spo = context.getObject(spoClass, objectIdOrName);
						dynamicValue.setValue(spo);
						add = true;
					}
				} else if (valueType.equals("script")) {
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

	@POST
	@Path("asyncAbort")
	@RequiredRight("IDW_SP_RuleRunner")
	public Response asyncAbort(Map<String, Object> jsonBody) {
		return handle(() -> {
			String uuid = Util.otoa(jsonBody.get("uuid"));
			if (Util.isNullOrEmpty(uuid)) {
				throw new IllegalArgumentException("Must supply a UUID as a query parameter");
			}
			RuleRunnerBackgroundThread worker = backgroundThreads.get(uuid);
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

			Map<String, Object> response = new HashMap<>();
			if (Util.isNotNullOrEmpty(logLevel)) {
				minLevel = LogStreamWrapper.Level.valueOf(logLevel);
			}
			response.put("stats", worker.taskMonitor.toMap());
			response.put("uuid", uuid);
			response.put("logs", worker.getLog().getMessages(minLevel));
			if (Util.isNullOrEmpty(worker.getKey())) {
				// This will only happen when the worker is done
				response.put("output", transformResult(worker.getOutput()));
			} else {
				log.warn("Worker thread did not abort within ten seconds of being triggered");
			}

			response.put("host", Util.getHostName());
			return response;
		});
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
	public Response getAsyncUpdate(@QueryParam("uuid") String uuid, @QueryParam("logLevel") String logLevel) {
		return handle(() -> {
			if (Util.isNullOrEmpty(uuid)) {
				throw new IllegalArgumentException("Must supply a UUID as a query parameter");
			}
			RuleRunnerBackgroundThread worker = backgroundThreads.get(uuid);
			if (worker == null) {
				throw new IllegalArgumentException("No worker with UUID = " + uuid);
			}

			Map<String, Object> response = new HashMap<>();
			LogStreamWrapper.Level minLevel = null;
			if (Util.isNotNullOrEmpty(logLevel)) {
				minLevel = LogStreamWrapper.Level.valueOf(logLevel);
			}
			response.put("stats", worker.taskMonitor.toMap());
			response.put("uuid", uuid);
			response.put("logs", worker.getLog().getMessages(minLevel));
			if (Util.isNullOrEmpty(worker.getKey())) {
				// This will only happen when the worker is done
				response.put("output", transformResult(worker.getOutput()));
			}

			response.put("host", Util.getHostName());

			return response;
		});
	}
	
	@Override
	public String getPluginName() {
		return "IDWRuleRunnerPlugin";
	}

	/**
	 * Returns the audited history of the logged-in user
	 * @return The audited history
	 */
	@GET
	@Path("history")
	@RequiredRight("IDW_SP_RuleRunner")
	public Response getMyRuleHistory() {
		return handle(() -> {
			QueryOptions qo = new QueryOptions();
			qo.addFilter(Filter.eq("target", "Execute"));
			qo.addFilter(Filter.eq("source", getLoggedInUserName()));
			qo.addFilter(Filter.eq("action", RUN_RULE_PLUGIN_ACTION));

			List<HistoryEntry> history = new ArrayList<>();
			IncrementalObjectIterator<AuditEvent> auditEvents = new IncrementalObjectIterator<>(getContext(), AuditEvent.class, qo);
			while(auditEvents.hasNext()) {
				AuditEvent ae = auditEvents.next();
				history.add(new HistoryEntry(ae));
			}

			return history;
 		});
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

	@POST
	@Path("parse")
	@RequiredRight("IDW_SP_RuleRunner")
	public Response parse(Map<String, Object> params) {
		return handle(() -> {
			String script = (String) params.get("script");
			List<String> librarySources = new ArrayList<>();
			if (params.get("libraries") instanceof Map) {
				@SuppressWarnings("unchecked")
				List<Map<String, String>> libraries = (List<Map<String, String>>) params.get("libraries");
				if (libraries != null) {
					for (Map<String, String> lib : libraries) {
						String libName = lib.get("title");
						Rule libRule = getContext().getObjectByName(Rule.class, libName);
						librarySources.add(libRule.getSource());
					}
				}
			}
			boolean includeWebClasses = Util.otob(params.get("includeWebClasses"));
			BeanshellSyntaxChecker checker = new BeanshellSyntaxChecker(script, librarySources, log);
			checker.addExpectedVariable("uuid", String.class);
			checker.addExpectedVariable("monitor", RuleRunnerTaskMonitor.class);
			if (includeWebClasses) {
				checker.addExpectedVariable("webService", BasePluginResource.class);
				checker.addExpectedVariable("httpRequest", HttpServletRequest.class);
				checker.addExpectedVariable("httpResponse", HttpServletResponse.class);
			}
			boolean isWorkflowRuleLibrary = Util.otob(params.get("isWorkflowRuleLibrary"));
			if (isWorkflowRuleLibrary) {
				checker.addExpectedVariable("launcher", String.class);
				checker.addExpectedVariable("wfcontext", WorkflowContext.class);
			}
			checker.setSuppressRawTypeErrors(Util.otob(params.get("suppressRawTypeErrors")));
			if (params.containsKey("variables") && params.get("variables") instanceof Map) {
				for(Map.Entry<String, Object> variable : Util.otom(params.get("variables")).entrySet()) {
					String type = Util.otoa(variable.getValue());
					if (Util.isNullOrEmpty(type)) {
						type = "Object";
					}
					checker.addExpectedVariable(variable.getKey(), type);
				}
			}
			return checker.parse();
		});
	}

	@SuppressWarnings("unchecked")
	@POST
	@Path("run")
	@RequiredRight("IDW_SP_RuleRunner")
	public Response run(Map<String, Object> params) {
		return handle(() -> {
			Map<String, Object> response = new HashMap<>();
			try {
				boolean async = false;
				int ruleTimeout = 10; 
				if (params.containsKey("async") && params.get("async") != null) {
					if (params.get("async") instanceof String) {
						async = Boolean.parseBoolean((String)params.get("async"));
					} else if (params.get("async") instanceof Boolean) {
						async = (Boolean)params.get("async");
					}
				}
				// Grab desired timeout if present in UI
				if (params.containsKey("ruleTimeout") && Util.isNotNullOrEmpty(Util.otoa(params.get("ruleTimeout")))) {
					if (params.get("ruleTimeout") instanceof String) {
						log.debug(params.get("ruleTimeout"));
						try {
							ruleTimeout = Integer.parseInt((String)params.get("ruleTimeout"));
							log.debug("Custom timeout detected, setting value: " + ruleTimeout);
						}
						catch(Exception e) {
							log.warn("Issue converting value in text field to int.");
							log.warn(e);
						}
					}
					else {
						log.warn("Issue assigning custom timeout time, defaulting to 10 min");
						log.warn(params.get("ruleTimeout"));
					}
				}
				
				boolean includeWebClasses = Util.otob(params.get("includeWebClasses"));

				// Abort on bad input as soon as possible
				if (async && includeWebClasses) {
					throw new IllegalArgumentException("Cannot execute both async and with web classes");
				}

				Rule fakeRule = new Rule();
				fakeRule.setLanguage("beanshell");
				fakeRule.setSource(addInterrupts((String) params.get("script")));
				fakeRule.setName("_RuleRunnerResource" + System.currentTimeMillis());
				List<Rule> referencedRules = new ArrayList<Rule>();

				if (params.containsKey("libraries") && params.get("libraries") instanceof List) {
					for(Map<String, String> library : ((List<Map<String, String>>)params.get("libraries"))) {
						String name = library.get("title");
						Rule rule = getContext().getObjectByName(Rule.class, name);
						if (rule != null) {
							referencedRules.add(rule);
						}
					}
					fakeRule.setReferencedRules(referencedRules);
				}

				if (log.isDebugEnabled()) {
					log.debug("Rule XML: " + fakeRule.toXml());
				}

				Map<String, Object> inputs = new HashMap<>();
				if (params.get("variables") instanceof List) {
					Map<String, DynamicValue> variableValuators = new HashMap<>();
					List<String> variableNames = new ArrayList<>();
					populateValuators(getContext(), params, variableValuators, variableNames);

					if (log.isDebugEnabled()) {
						log.debug("Evaluating dynamic variable values: " + variableNames);
					}

					for(String name : variableNames) {
						if (name.equals("log") || name.equals("context") || name.equals("monitor") || name.equals("_log")) {
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

				String randomCode = UUID.randomUUID().toString();

				if (Auditor.isEnabled(RUN_RULE_PLUGIN_ACTION)) {
					AuditEvent auditEvent = new AuditEvent();
					auditEvent.setSource(super.getLoggedInUser().getName());
					auditEvent.setAction(RUN_RULE_PLUGIN_ACTION);
					auditEvent.setTarget("Execute");
					auditEvent.setAttribute("uuid", randomCode);
					auditEvent.setAttribute("code", fakeRule.getSource());
					auditEvent.setAttribute("libraries", ObjectUtil.getObjectNames(referencedRules));
					auditEvent.setAttribute("async", async);
					auditEvent.setAttribute("includeWebClasses", includeWebClasses);
					auditEvent.setAttribute("inputVariables", inputs.keySet());
					auditEvent.setAttribute("host", Util.getHostName());
					auditEvent.setAttribute("client", Utils.getRemoteIp(request));
					Auditor.log(auditEvent);
					getContext().commitTransaction();
				}

				Map<String, Object> parameters = new HashMap<>(inputs);
				parameters.put("uuid", randomCode);

				if (async) {
					Log log = LogFactory.getLog(RuleRunnerBackgroundThread.class);
					LogStreamWrapper wrappedLog = new LogStreamWrapper(log);
					RuleRunnerBackgroundThread backgroundWorker = new RuleRunnerBackgroundThread(fakeRule, parameters, wrappedLog);
					Thread backgroundThread = new Thread(backgroundWorker);
					backgroundThread.setDaemon(true);
					backgroundThread.setName("RuleRunnerBackgroundThread - " + backgroundWorker.getKey());
					backgroundThread.start();
					RuleRunnerMonitorThread monitorThread = new RuleRunnerMonitorThread(backgroundThread, ruleTimeout, TimeUnit.MINUTES);
					monitorThread.start();
					backgroundWorker.setMonitor(monitorThread);
					backgroundThreads.put(randomCode, backgroundWorker);
					log.warn("Started rule runner background threads with worker UUID " + randomCode);

					backgroundThread.join(3000L);
					if (!backgroundThread.isAlive()) {
						// Finished up within the 3 second window
						Object result = backgroundThreads.get(randomCode).getOutput();
						response.put("async", false);
						response.put("uuid", randomCode);
						response.put("output", transformResult(result));
						response.put("logs", wrappedLog.getMessages(LogStreamWrapper.Level.Debug));
					} else {
						response.put("async", true);
						response.put("uuid", randomCode);
						response.put("logs", wrappedLog.getMessages(LogStreamWrapper.Level.Debug));
					}
				} else {
					if (includeWebClasses) {
						parameters.put("webService", this);
						parameters.put("httpRequest", request);
						parameters.put("httpResponse", response);
					}
					LogStreamWrapper wrappedLog = new LogStreamWrapper(log);
					parameters.put("log", wrappedLog);
					parameters.put("_log", wrappedLog);
					Object result = getContext().runRule(fakeRule, parameters);
					response.put("async", false);
					response.put("uuid", randomCode);
					response.put("output", transformResult(result));
					response.put("logs", wrappedLog.getMessages(LogStreamWrapper.Level.Debug));
				}
			} catch(Throwable e) {
				response.put("output", transformResult(e));
			}
			response.put("host", Util.getHostName());
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
			String source = Util.otoa(params.get("source"));
			if (Util.isNullOrEmpty(source) || source.trim().isEmpty()) {
				throw new IllegalArgumentException("The rule source must not be blank");
			}
			List<String> libraries = new ArrayList<>();
			if (params.containsKey("libraries") && params.get("libraries") instanceof List) {
				libraries = Util.otol(params.get("libraries"));
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
			ruleObject.setLanguage("beanshell");
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

	private Object transformResult(Object result) throws GeneralException {
		Map<String, Object> resultMap = new HashMap<>();
		if (result == null) {
			resultMap.put("isNull", true);
		} else if (result instanceof Attributes || result instanceof Custom) {
			// These types are both instances of Map and will be serialized as such,
			// so we can return it directly
			resultMap.put("value", new TreeMap((Map)result));
			resultMap.put("type", result.getClass().getName());
		} else if (result instanceof SailPointObject) {
			SailPointObject spo = (SailPointObject)result;
			resultMap.put("value", spo.toXml());
			resultMap.put("type", spo.getClass().getName());
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
			resultMap.put("type", result.getClass().getName());
			List<Object> outputs = new ArrayList<>();
			for(Object val : ((Collection)result)) {
				if (val instanceof SailPointObject) {
					SailPointObject spo = (SailPointObject) val;
					Map<String, Object> spoMap = new TreeMap<>();
					spoMap.put("type", spo.getClass().getName());
					spoMap.put("id", spo.getId());
					spoMap.put("name", spo.getName());
					if (spo instanceof Link) {
						Link l = (Link)spo;
						spoMap.put("nativeIdentity", l.getNativeIdentity());
						spoMap.put("application", l.getApplicationName());
						spoMap.put("identity", l.getIdentity() == null ? null : l.getIdentity().getName());
						spoMap.put("disabled", l.isDisabled());
						spoMap.put("locked", l.isLocked());
					} else if (spo instanceof Identity) {
						Identity i = (Identity)spo;
						spoMap.put("displayName", i.getDisplayName());
						spoMap.put("inactive", i.isInactive());
						spoMap.put("workgroup", i.isWorkgroup());
						spoMap.put("correlated", i.isCorrelated());
						spoMap.put("lastRefresh", i.getLastRefresh() == null ? null : i.getLastRefresh().toString());
						spoMap.put("assignedRoles", Utilities.safeStream(i.getActiveRoleAssignments()).map(RoleAssignment::getRoleName).collect(Collectors.toList()));
						spoMap.put("links", Utilities.safeStream(i.getLinks()).map(l -> l.getApplicationName() + " " + l.getNativeIdentity() + " (" + (l.isDisabled() ? "disabled" : "enabled") + ")").collect(Collectors.toList()));
					}
					outputs.add(spoMap);
				} else if (val == null) {
					outputs.add(null);
				} else {
					outputs.add(String.valueOf(val));
				}
			}
			resultMap.put("value", outputs);
		} else {
			resultMap.put("type", result.getClass().getName());
			resultMap.put("value", result.toString());
		}
		return resultMap;
	}

}
