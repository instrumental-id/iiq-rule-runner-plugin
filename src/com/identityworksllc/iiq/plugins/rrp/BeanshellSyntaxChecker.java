package com.identityworksllc.iiq.plugins.rrp;

import com.identityworksllc.iiq.common.minimal.logging.SLogger;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.eclipse.jdt.core.compiler.CategorizedProblem;
import org.eclipse.jdt.core.compiler.CharOperation;
import org.eclipse.jdt.internal.compiler.Compiler;
import org.eclipse.jdt.internal.compiler.DefaultErrorHandlingPolicies;
import org.eclipse.jdt.internal.compiler.ICompilerRequestor;
import org.eclipse.jdt.internal.compiler.batch.CompilationUnit;
import org.eclipse.jdt.internal.compiler.classfmt.ClassFileReader;
import org.eclipse.jdt.internal.compiler.env.ICompilationUnit;
import org.eclipse.jdt.internal.compiler.env.INameEnvironment;
import org.eclipse.jdt.internal.compiler.env.NameEnvironmentAnswer;
import org.eclipse.jdt.internal.compiler.impl.CompilerOptions;
import org.eclipse.jdt.internal.compiler.problem.DefaultProblemFactory;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.Reader;
import java.io.UnsupportedEncodingException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * This class is responsible for transforming a Beanshell script into a proper
 * compilable Java class, compiling that class, and then translating the errors
 * back to the appropriate Beanshell line number. It supports all SailPoint Beanshell
 * operations, including Rule Libraries.
 *
 * It does not support those features of Beanshell that are not proper Java, such as
 * casting methods to SAM interfaces.
 */
public class BeanshellSyntaxChecker {

	/**
	 * Largely lifted from Apache Sling, here:
	 * https://github.com/apache/sling-org-apache-sling-commons-compiler/blob/master/src/main/java/org/apache/sling/commons/compiler/impl/EclipseJavaCompiler.java
	 *
	 * Licensed under the Apache license, free for private re-use
	 */
	public static class BeanshellNameEnvironment implements INameEnvironment {

		private final List<ICompilationUnit> units;

		public BeanshellNameEnvironment(List<ICompilationUnit> units) {
			this.units = units;
		}

		@Override
		public void cleanup() {
			/* Nothing to do */
		}

		/**
		 * @param name The name of the class
		 * @return The contents of the class file
		 * @throws Exception on failures
		 */
		private byte[] findClass(String name) throws Exception {
			final String resourceName = name.replace('.', '/') + ".class";
			final InputStream is = this.getClass().getClassLoader().getResourceAsStream(resourceName);
			if (is != null) {
				try {
					byte[] buf = new byte[8192];
					ByteArrayOutputStream baos = new ByteArrayOutputStream(buf.length);
					int count;
					while ((count = is.read(buf, 0, buf.length)) > 0) {
						baos.write(buf, 0, count);
					}
					baos.flush();
					return baos.toByteArray();
				} finally {
					try {
						is.close();
					} catch (IOException ignore) {}
				}
			}
			return null;
		}

		@Override
		public NameEnvironmentAnswer findType(char[][] compoundTypeName) {
			String fqn = CharOperation.toString(compoundTypeName);
			if (fqn.equals("_Test")) {
				return new NameEnvironmentAnswer(units.get(0), null);
			}

			try {
				byte[] bytes = findClass(fqn);
				if (bytes == null) {
					return null;
				}
				ClassFileReader classFileReader = new ClassFileReader(bytes, fqn.toCharArray(), true);
				return new NameEnvironmentAnswer(classFileReader, null);
			} catch (Exception e) {
				return null;
			}
		}

		@Override
		public NameEnvironmentAnswer findType(char[] typeName, char[][] packageName) {
			return findType(CharOperation.arrayConcat(packageName, typeName));
		}

		/**
		 * Apache Sling hack to see if this is a package: can we load it as a class? If no, it's a package.
		 * @param candidate The name to test
		 * @return True if this is a package
		 */
		private boolean isPackage(String candidate) {
			String resourceName = candidate.replace('.', '/') + ".class";
			try (InputStream is = this.getClass().getClassLoader().getResourceAsStream(resourceName)) {
				return is == null;
			} catch (IOException e) {
				return false;
			}
		}

		@Override
		public boolean isPackage(char[][] parentPackageName, char[] packageName) {
			String fqn = CharOperation.toString(CharOperation.arrayConcat(parentPackageName, packageName));
			if (fqn.equals("_Test")) {
				return false;
			}
			return isPackage(fqn);
		}
	}

	public static class Import {
		String importLine;
		int originalLine;
	}

	public static class SourceLine {
		int originalLine;
		String sourceLine;
	}

	protected static final String RR_GENERIC_TYPE = "// RR generic type:";

	/**
	 * Used to detect function / method header blocks
	 */
	private static final Pattern functionHeaderPattern = Pattern.compile("(public|private|static)*\\s*(\\w+)\\s+(\\w+)\\s*\\(.*?\\)\\s*(throws .*?)?\\s*\\{");

	/**
	 * Demo main method
	 * @param args Command args
	 * @throws Exception on failures
	 */
	public static void main(String[] args) throws Exception {
		/*
		System.out.println(System.getProperty("java.home"));
		InputStream inputStream = BeanshellSyntaxChecker.class.getResourceAsStream("/LibraryTest");
		StringBuilder textBuilder = new StringBuilder();
		try (Reader reader = new BufferedReader(new InputStreamReader(inputStream, Charset.forName(StandardCharsets.UTF_8.name())))) {
			int c = 0;
			while ((c = reader.read()) != -1) {
				textBuilder.append((char) c);
			}
		}
		Log logger = LogFactory.getLog(BeanshellSyntaxChecker.class);
		BeanshellSyntaxChecker checker = new BeanshellSyntaxChecker(textBuilder.toString(), new ArrayList<>(), new SLogger(logger));
		System.out.println(checker.parse());
		*/
		InputStream inputStream = BeanshellSyntaxChecker.class.getResourceAsStream("/CompletionTest");
		StringBuilder textBuilder = new StringBuilder();
		try (Reader reader = new BufferedReader(new InputStreamReader(inputStream, Charset.forName(StandardCharsets.UTF_8.name())))) {
			int c = 0;
			while ((c = reader.read()) != -1) {
				textBuilder.append((char) c);
			}
		}
		Log logger = LogFactory.getLog(BeanshellSyntaxChecker.class);
		BeanshellSyntaxChecker checker = new BeanshellSyntaxChecker(textBuilder.toString(), new ArrayList<>(), new SLogger(logger));
		System.out.println(checker.parse());
	}

	/**
	 * A map of expected injected variables for the given rule type
	 */
	private final Map<String, String> expectedInjectedVariables;
	/**
	 * The highest line number not associated with a library
	 */
	private int highestNonLibraryLine;
	/**
	 * Logger
	 */
	private final SLogger log;
	/**
	 * The original source code lines before mangling
	 */
	private String[] originalLines;
	/**
	 * The original raw source code before mangling
	 */
	private String rawSource;
	/**
	 * A conversion from the mangled source code's line numbers to the original source code's line numbers
	 */
	private final Map<Integer, Integer> sourceLineConversionMap;

	/**
	 * If true, "cannot convert from Object to ___" errors will be suppressed
	 */
	private boolean suppressRawTypeErrors;

	public BeanshellSyntaxChecker(String rawSource, List<String> ruleLibrarySources, SLogger log) {
		this.log = log;
		this.rawSource = rawSource;
		if (!this.rawSource.trim().endsWith(";") && !this.rawSource.trim().endsWith("}")) {
			this.rawSource += ";";
		}
		if (ruleLibrarySources != null) {
			this.rawSource += "// __RULE_LIBRARIES__\n";
			for(String source : ruleLibrarySources) {
				source = "\n" + source;
				if (!source.trim().endsWith(";") && !source.trim().endsWith("}")) {
					source += ";";
				}
				this.rawSource += source;
			}
		}
		this.sourceLineConversionMap = new HashMap<>();
		this.expectedInjectedVariables = new HashMap<>();
	}

	public void addExpectedVariable(String variableName, String type) {
		this.expectedInjectedVariables.put(variableName, type);
	}

	public void addExpectedVariable(String variableName, Class<?> type) {
		this.expectedInjectedVariables.put(variableName, type.getName().replace("$", "."));
	}

	/**
	 * Compiles the given source code using the standalone EclipseCompiler (ECJ), which produces
	 * much better error messages than the built-in Java compiler.
	 *
	 * @param code The code to compile
	 * @param filename The fake filename of the code
	 * @return A list of error messages, if any
	 */
	public List<Map<String, Object>> compile(String code, String filename) {
		List<Map<String, Object>> messages = new ArrayList<>();
		ICompilerRequestor requestor = result -> {
			if (result.hasProblems()) {
				for(CategorizedProblem problem : result.getErrors()) {
					if (problem.getMessage() != null && problem.getMessage().contains("cannot convert from element type Object")) {
						// Suppress these by default; they're likely generic issues
						continue;
					}
					String errorMessage = problem.getMessage();
					if (errorMessage != null) {
						if (suppressRawTypeErrors) {
							String[] errors = new String[] {
									"cannot convert from Object",
									"for the arguments (Object)"
							};
							boolean skip = false;
							for(String err : errors) {
								if (errorMessage.contains(err)) {
									skip = true;
									break;
								}
							}
							if (skip) {
								continue;
							}
						}
						errorMessage = errorMessage.replace(" in the type _Test", "");
						errorMessage = errorMessage.replace(" for the type _Test", "");
						Map<String, Object> message = new HashMap<>();
						message.put("message", errorMessage);
						Integer line = sourceLineConversionMap.get(problem.getSourceLineNumber() - 1);
						if (line != null) {
							// Suppress compilation errors in rule libraries
							if (line > highestNonLibraryLine) {
								if (log.isDebugEnabled()) {
									log.debug("Suppressing error in rule library " + errorMessage);
								}
								continue;
							}
							message.put("line", line);
							int startPosition = problem.getSourceStart();
							int endPosition = problem.getSourceEnd();
							if (startPosition > 0 && endPosition > 0) {
								String substring = code.substring(startPosition, endPosition + 2);
								message.put("start", originalLines[line].indexOf(substring));
								message.put("end", (int) message.get("start") + (problem.getSourceEnd() - problem.getSourceStart()));
							}
							messages.add(message);
						}
					}
				}
			}
		};
		CompilerOptions options = new CompilerOptions();
		options.targetJDK = CompilerOptions.releaseToJDKLevel(CompilerOptions.VERSION_11);
		options.complianceLevel = CompilerOptions.releaseToJDKLevel(CompilerOptions.VERSION_11);
		options.sourceLevel = CompilerOptions.releaseToJDKLevel("6");
		options.suppressWarnings = true;
		options.enableJdtDebugCompileMode = true;
		//options.performMethodsFullRecovery = true;
		//options.performStatementsRecovery = true;
		options.produceReferenceInfo = true;
		CompilationUnit[] units = new CompilationUnit[] { new CompilationUnit(code.toCharArray(), filename, null) };
		BeanshellNameEnvironment bne = new BeanshellNameEnvironment(Arrays.asList(units));
		if (log.isDebugEnabled()) {
			log.debug("Compiling source code " + code);
		}
		Compiler compiler = new Compiler(bne, DefaultErrorHandlingPolicies.exitAfterAllProblems(), options, requestor, new DefaultProblemFactory());
		compiler.compile(units);
		if (log.isDebugEnabled()) {
			log.debug("Error results are: " + messages);
		}
		return messages;
	}

	/**
	 * Takes the given Beanshell source code and forces it into a Java class structure
	 * to be compiled. This does a bunch of interesting operations on the source code.
	 *
	 * First, it collapses parentheses blocks across multiple lines into a single line.
	 * For example, a function call like:
	 *
	 *   f(
	 *      a,
	 *      b,
	 *      c
	 *   );
	 *
	 * will be collapsed into:
	 *
	 *   f(a,b,c);
	 *
	 * This helps with parsing later.
	 *
	 * Second, it handles the special Beanshell type 'void' for compilation purposes.
	 *
	 * Third, it interprets comments of the form 'RR generic type:' or 'Expect:'. The
	 * latter is compatible with the IIQDA Eclipse plugin. The former works around the
	 * generic type limitations of Beanshell.
	 *
	 * Fourth, it chops comments off the end of lines.
	 *
	 * Fifth, it rearranges the source so that methods are outside of the main source
	 * code by identifying each line of code as either an "import line", "method line"
	 * or a "standalone line". Standalone lines will end up inside their own method,
	 * even if they are not adjacent in the Beanshell script. Imports will all be
	 * moved to the top.
	 *
	 * The rearranged class looks like:
	 *
	 *   import java.util.*;
	 *   import java.io.*;
	 *   import sailpoint.api.SailPointContext;
	 *
	 *   // INPUT: Your Beanshell script imports
	 *
	 *   public class _Test {
	 *   	 // Common static variables like context, log, etc
	 *   	 private static SailPointContext context;
	 *
	 *   	 // INPUT: Specific static variables expected for rule inputs
	 *
	 *       // INPUT: Rule library methods
	 *
	 *       // INPUT: Your Beanshell script methods
	 *
	 *       public Object _standaloneMethodParse() throws Throwable {
	 *           // INPUT: Standalone lines
	 *       }
	 *   }
	 *
	 * Original line numbers and character positions are retained so that the error can
	 * be appropriately swapped back to its position in Beanshell.
	 *
	 * @return The transformed source code
	 * @throws UnsupportedEncodingException if the data cannot be read
	 */
	private String mangleSource() throws UnsupportedEncodingException {
		List<Import> imports = new ArrayList<>();
		List<SourceLine> blockLines = new ArrayList<>();
		List<SourceLine> standaloneLines = new ArrayList<>();
		List<SourceLine> staticLines = new ArrayList<>();
		List<SourceLine> collapsedBlockLines = new ArrayList<>();

		this.originalLines = rawSource.split("\n");
		boolean inBlock = false;
		long curlyBraceBalance = 0;
		long parensBalance = 0;

		String lineContent = "";
		int lastStartLine = 0;

		for (int lineNumber = 0; lineNumber < originalLines.length; lineNumber++) {
			lineContent += originalLines[lineNumber];

			long openParens = lineContent.chars().filter(ch -> ch == '(').count();
			long closeParens = lineContent.chars().filter(ch -> ch == ')').count();
			parensBalance = openParens - closeParens;

			if (lineContent.trim().startsWith("//") || parensBalance == 0) {
				SourceLine sourceLine = new SourceLine();
				sourceLine.originalLine = lastStartLine;
				sourceLine.sourceLine = lineContent;

				collapsedBlockLines.add(sourceLine);

				lineContent = "";
				lastStartLine = lineNumber + 1;
			}
		}

		parensBalance = 0;

		String lastGenericSignature = null;
		String lastGenericReplace = null;

		for(SourceLine collapsedLine : collapsedBlockLines) {
			int lineNumber = collapsedLine.originalLine;
			String line = collapsedLine.sourceLine;

			if (line.contains("__RULE_LIBRARIES__")) {
				this.highestNonLibraryLine = lineNumber;
			}
			if (line.trim().startsWith("import ")) {
				Import imp = new Import();
				imp.originalLine = lineNumber;
				imp.importLine = line;
				imports.add(imp);
			} else {

				if (line.contains("void ==") || line.contains("== void") || line.contains("void !=") || line.contains("!= void")) {
					line = line.replace("void", "\"\"");
				}

				if (line.trim().startsWith(RR_GENERIC_TYPE)) {
					lastGenericSignature = line.trim().substring(RR_GENERIC_TYPE.length()).trim() + " ";
					lastGenericReplace = lastGenericSignature.substring(0, lastGenericSignature.indexOf("<")) + " ";
				} else if (lastGenericReplace != null){
					if (line.contains(lastGenericReplace)) {
						line = line.replaceFirst(Pattern.quote(lastGenericReplace), Matcher.quoteReplacement(lastGenericSignature));
						lastGenericReplace = null;
						lastGenericSignature = null;
					}
				}

				if (line.trim().startsWith("// Expect: ")) {
					String expectContent = line.trim().substring("// Expect: ".length()).trim();
					String name = expectContent.substring(expectContent.lastIndexOf(" ") + 1);
					String type = expectContent.substring(0, expectContent.lastIndexOf(" "));

					expectedInjectedVariables.put(name, type);
				}

				SourceLine sourceLine = new SourceLine();
				sourceLine.originalLine = lineNumber;
				sourceLine.sourceLine = line;

				if (!inBlock) {
					if (curlyBraceBalance == 0 && parensBalance == 0) {
						Matcher matcher = functionHeaderPattern.matcher(line);
						if (matcher.find()) {
							String linePart = matcher.group().trim();
							if (!(linePart.startsWith("catch ") || linePart.startsWith("catch(") || linePart.startsWith("if") || linePart.startsWith("while") || linePart.startsWith("for"))) {
								//System.out.println("In method " + matcher.group());
								inBlock = true;
							}
						}
					}
					if (inBlock) {
						blockLines.add(sourceLine);
					} else {
						if (parensBalance == 0 && curlyBraceBalance == 0 && (
								line.trim().matches("(static\\s+)?(\\w+)\\s+(\\w+)\\s*;")||
										line.trim().matches("(static\\s+)?(\\w+)\\s+(\\w+)\\s*=\\s*.*;"))
						) {
							if (line.trim().contains("(") || line.trim().contains("{") || line.trim().contains("return ")) {
								standaloneLines.add(sourceLine);
							} else {
								staticLines.add(sourceLine);
							}
						} else {
							standaloneLines.add(sourceLine);
						}
					}

					if (line.contains("//")) {
						line = line.substring(0, line.indexOf("//"));
					}

					long openBraces = line.chars().filter(ch -> ch == '{').count();
					long closeBraces = line.chars().filter(ch -> ch == '}').count();
					curlyBraceBalance += openBraces;
					curlyBraceBalance -= closeBraces;

					long openParens = line.chars().filter(ch -> ch == '(').count();
					long closeParens = line.chars().filter(ch -> ch == ')').count();
					parensBalance += openParens;
					parensBalance -= closeParens;

				} else {
					blockLines.add(sourceLine);

					if (line.contains("//")) {
						line = line.substring(0, line.indexOf("//"));
					}

					long openBraces = line.chars().filter(ch -> ch == '{').count();
					long closeBraces = line.chars().filter(ch -> ch == '}').count();
					curlyBraceBalance += openBraces;
					curlyBraceBalance -= closeBraces;

					long openParens = line.chars().filter(ch -> ch == '(').count();
					long closeParens = line.chars().filter(ch -> ch == ')').count();
					parensBalance += openParens;
					parensBalance -= closeParens;

					if (curlyBraceBalance == 0) {
						inBlock = false;
						//System.out.println("Left method; parens balance = " + parensBalance);
					}
				}
			}
		}

		ByteArrayOutputStream baos = new ByteArrayOutputStream();
		PrintWriter pw = new PrintWriter(baos);
		int newLineNumber = 0;

		for(Import imp : imports) {
			sourceLineConversionMap.put(newLineNumber, imp.originalLine);
			pw.println(imp.importLine);
			newLineNumber++;
		}

		pw.println();
		pw.println();
		pw.println("import java.util.*;");
		pw.println("import java.io.*;");
		pw.println("import sailpoint.api.SailPointContext;");
		pw.println("import org.apache.commons.logging.Log;");
		pw.println("public class _Test {");
		pw.println("private static SailPointContext context;");
		pw.println("private static Log log;");

		newLineNumber += 9;

		if (!expectedInjectedVariables.isEmpty()) {
			for(String variable : expectedInjectedVariables.keySet()) {
				pw.println("private static " + expectedInjectedVariables.get(variable) + " " + variable + ";");
				newLineNumber++;
			}
		}

		for(SourceLine line : blockLines) {
			sourceLineConversionMap.put(newLineNumber, line.originalLine);
			pw.println(line.sourceLine);
			newLineNumber++;
		}

		pw.println();
		pw.println();
		pw.println("// Standalone lines here");

		newLineNumber += 3;

		for(SourceLine line : staticLines) {
			sourceLineConversionMap.put(newLineNumber, line.originalLine);
			pw.println(line.sourceLine);
			newLineNumber++;
		}

		pw.println("public Object _standaloneMethodParse() throws Throwable {");
		newLineNumber++;

		boolean hasReturn = false;
		for(SourceLine line : standaloneLines) {
			sourceLineConversionMap.put(newLineNumber, line.originalLine);
			pw.println(line.sourceLine);
			newLineNumber++;
			if (line.sourceLine.contains("return ")) {
				hasReturn = true;
			}
		}

		if (!hasReturn) {
			pw.println("return null;");
		}

		pw.println("}");
		pw.println("}");

		pw.close();
		String newSource = baos.toString("UTF-8");

		log.debug(newSource);

		return newSource;
	}

	/**
	 * Mangles and then compiles the source code, producing a List of error messages and locations
	 * @return The list of error messages (if any)
	 * @throws Exception if a parse error occurs
	 */
	public List<Map<String, Object>> parse() throws Exception {
		String newSource = mangleSource();
		return compile(newSource, "_RuleRunnerEmbedded.java");
	}

	public void setSuppressRawTypeErrors(boolean suppressRawTypeErrors) {
		this.suppressRawTypeErrors = suppressRawTypeErrors;
	}
}
