package com.identityworksllc.iiq.plugins.rrp.tools;

import com.googlecode.lanterna.TerminalSize;
import com.googlecode.lanterna.gui2.*;
import com.googlecode.lanterna.screen.Screen;
import com.googlecode.lanterna.terminal.DefaultTerminalFactory;
import picocli.CommandLine;

import java.io.BufferedReader;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.concurrent.Callable;
import java.util.stream.Stream;

public class CommandLineRuleRunner implements Callable<Integer> {

    private static String readFile(String filePath) throws IOException {
        StringBuilder content = new StringBuilder();
        try (Stream<String> stream = Files.lines(Paths.get(filePath), StandardCharsets.UTF_8)) {
            stream.forEach(s -> content.append(s).append("\n"));
        }
        return content.toString();
    }

    private static boolean isNullOrEmpty(String input) {
        return (input == null || input.equals(""));
    }

    private static boolean isNotNullOrEmpty(String input) {
        return !isNullOrEmpty(input);
    }


    private static final String PARSE_URL = "/plugin/rest/IDWRuleRunnerPlugin/parse";
    private static final String RUN_URL = "/plugin/rest/IDWRuleRunnerPlugin/run";

    @CommandLine.Option(interactive = true, names = {"-p", "--password"})
    private char[] password;

    @CommandLine.Option(names = {"--password:file"})
    private File passwordFromFile;

    @CommandLine.Option(required = true, names = {"-u", "--username", "--user"})
    private String username;

    @CommandLine.Option(required = true, names = {"-h", "--url"})
    private URI baseUrl;

    private String rule;

    @CommandLine.Option(required = true, names = {"-r", "--rule"})
    private File ruleFile;

    @CommandLine.Option(names = {"-o", "--out"})
    private String outputFileName;

    public static void main(String args[]) throws IOException {
//        new CommandLine(new CommandLineRuleRunner()).execute(args);
        new CommandLineRuleRunner().startWindow();
    }

    @Override
    public Integer call() throws Exception {
        boolean hasPassword = false;
        if (password != null && password.length > 0) {
            hasPassword = true;
        }

        if (!hasPassword) {
            if (passwordFromFile.exists()) {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(passwordFromFile)))) {
                    String filePassword = reader.readLine();
                    if (filePassword != null) {
                        password = filePassword.toCharArray();
                        hasPassword = true;
                    }
                }
            }
        }

        if (!hasPassword) {
            throw new IllegalStateException("A password is required");
        }

        if (isNullOrEmpty(username)) {
            throw new IllegalStateException("A username is required");
        }

        if (ruleFile.exists() && ruleFile.canRead()) {
            rule = readFile(ruleFile.getPath()).trim();
        } else {
            throw new IllegalStateException("The specified rule file, " + ruleFile + ", does not exist or cannot be read");
        }

        if (isNullOrEmpty(rule)) {
            throw new IllegalStateException("A non-empty rule is required");
        }

        startWindow();

        return 0;
    }

    public void startWindow() throws IOException {
        DefaultTerminalFactory terminalFactory = new DefaultTerminalFactory();
        Screen theScreen = terminalFactory.createScreen();

        theScreen.startScreen();

        WindowBasedTextGUI textGUI = new MultiWindowTextGUI(theScreen);

        Window window = makeWindow();
        Window window2 = makeWindow();
        textGUI.addWindow(window);

        textGUI.addWindowAndWait(window2);

        theScreen.stopScreen();

    }

    private Window makeWindow() {
        Window window = new BasicWindow("Executing...");

        Panel contentPanel = new Panel(new GridLayout(3));
        contentPanel.setLayoutData(GridLayout.createHorizontallyFilledLayoutData());
        final ScrollBar verticalScroll = new ScrollBar(Direction.VERTICAL);

        GridLayout gridLayout = (GridLayout)contentPanel.getLayoutManager();
        gridLayout.setHorizontalSpacing(3);

        contentPanel.addComponent(new Label("hi guys this is a bit longer and ought to wrap onto the next line blah blah blah blah blah blah blah blah blah blah blah blah end").setPreferredSize(new TerminalSize(40, 2)));
        contentPanel.addComponent(
                new TextBox()
                        .setLayoutData(GridLayout.createLayoutData(GridLayout.Alignment.BEGINNING, GridLayout.Alignment.CENTER)));

        contentPanel.addComponent(verticalScroll);

        window.setComponent(contentPanel);
        return window;
    }
}
