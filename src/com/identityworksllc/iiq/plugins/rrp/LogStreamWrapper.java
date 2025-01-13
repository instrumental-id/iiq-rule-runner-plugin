package com.identityworksllc.iiq.plugins.rrp;

import org.apache.commons.logging.Log;
import sailpoint.tools.Util;

import java.io.IOException;
import java.io.PrintStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * The wrapper around the {@link Log} interface allowing log messages to be captured
 * and returned to the browser. This will be available to all scripts as both 'log'
 * and '_log'.
 */
public final class LogStreamWrapper implements Log {
    public enum Level {
        Trace,
        Debug,
        Info,
        Warn,
        Error,
        Fatal
    }

    private final Queue<LogMessageVO> messages;
    private final Log passthrough;

    public LogStreamWrapper(Log passthrough) {
        this.passthrough = passthrough;
        this.messages = new ConcurrentLinkedQueue<>();
    }

    /**
     * Log a message with debug log level.
     *
     * @param message log this message
     */
    public void debug(Object message) {
        queue(Level.Debug, message, null);
        passthrough.debug(message);
    }

    /**
     * Log an error with debug log level.
     *  @param message log this message
     * @param t log this cause
     */
    public void debug(Object message, Throwable t) {
        queue(Level.Debug, message, t);
        passthrough.debug(message, t);
    }

    /**
     * Log a message with error log level.
     *
     * @param message log this message
     */
    public void error(Object message) {
        queue(Level.Error, message, null);
        passthrough.error(message);
    }

    /**
     * Log an error with error log level.
     *  @param message log this message
     * @param t log this cause
     */
    public void error(Object message, Throwable t) {
        queue(Level.Error, message, t);
        passthrough.error(message, t);
    }

    /**
     * Log a message with fatal log level.
     *
     * @param message log this message
     */
    public void fatal(Object message) {
        queue(Level.Fatal, message, null);
        passthrough.fatal(message);
    }

    /**
     * Log an error with fatal log level.
     *  @param message log this message
     * @param t log this cause
     */
    public void fatal(Object message, Throwable t) {
        queue(Level.Fatal, message, t);
        passthrough.fatal(message, t);
    }

    /**
     * Log a message with info log level.
     *
     * @param message log this message
     */
    public void info(Object message) {
        queue(Level.Info, message, null);
        passthrough.info(message);
    }

    /**
     * Log an error with info log level.
     *  @param message log this message
     * @param t log this cause
     */
    public void info(Object message, Throwable t) {
        queue(Level.Info, message, t);
        passthrough.info(message, t);
    }

    /**
     * Is debug logging currently enabled?
     * <p>
     * Call this method to prevent having to perform expensive operations
     * (for example, <code>String</code> concatenation)
     * when the log level is more than debug.
     *
     * @return true if debug is enabled in the underlying logger.
     */
    public boolean isDebugEnabled() {
        return passthrough.isDebugEnabled();
    }

    /**
     * Is error logging currently enabled?
     * <p>
     * Call this method to prevent having to perform expensive operations
     * (for example, <code>String</code> concatenation)
     * when the log level is more than error.
     *
     * @return true if error is enabled in the underlying logger.
     */
    public boolean isErrorEnabled() {
        return passthrough.isErrorEnabled();
    }

    /**
     * Is fatal logging currently enabled?
     * <p>
     * Call this method to prevent having to perform expensive operations
     * (for example, <code>String</code> concatenation)
     * when the log level is more than fatal.
     *
     * @return true if fatal is enabled in the underlying logger.
     */
    public boolean isFatalEnabled() {
        return passthrough.isFatalEnabled();
    }

    /**
     * Is info logging currently enabled?
     * <p>
     * Call this method to prevent having to perform expensive operations
     * (for example, <code>String</code> concatenation)
     * when the log level is more than info.
     *
     * @return true if info is enabled in the underlying logger.
     */
    public boolean isInfoEnabled() {
        return passthrough.isInfoEnabled();
    }

    /**
     * Is trace logging currently enabled?
     * <p>
     * Call this method to prevent having to perform expensive operations
     * (for example, <code>String</code> concatenation)
     * when the log level is more than trace.
     *
     * @return true if trace is enabled in the underlying logger.
     */
    public boolean isTraceEnabled() {
        return passthrough.isTraceEnabled();
    }

    /**
     * Is warn logging currently enabled?
     * <p>
     * Call this method to prevent having to perform expensive operations
     * (for example, <code>String</code> concatenation)
     * when the log level is more than warn.
     *
     * @return true if warn is enabled in the underlying logger.
     */
    public boolean isWarnEnabled() {
        return passthrough.isWarnEnabled();
    }

    /**
     * Gets the list of queued messages with the minimum level. The total number of messages in the queue
     * at the start of the polling process will be drained and processed.
     *
     * @param minimumLevel The minimum log level
     * @return The list of log messages to return to the browser
     */
    public List<LogMessageVO> getMessages(Level minimumLevel) {
        // Capture the size here, since the queue may be modified as we're working
        // and we don't want to loop forever.
        int queueSize = this.messages.size();
        List<LogMessageVO> logMessages = new ArrayList<>();
        for(int i = 0; i < queueSize; i++) {
            LogMessageVO output = this.messages.poll();
            if (output != null) {
                if (minimumLevel == null || Level.valueOf(output.getLevel()).ordinal() >= minimumLevel.ordinal()) {
                    logMessages.add(output);
                }
            }
        }
        return logMessages;
    }

    /**
     * Enqueues the given message as a {@link LogMessageVO}, to be retrieved by the browser
     * on the next poll.
     *
     * @param level The log level
     * @param message The message associated with the log
     * @param throwable The throwable associated with the log message
     */
    private void queue(Level level, Object message, Throwable throwable) {
        Date now = new Date();
        SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS");

        LogMessageVO vo = new LogMessageVO();
        String logMessage = String.valueOf(message);

        try (StringWriter output = new StringWriter()) {
            try (PrintWriter printStream = new PrintWriter(output)) {
                if (Util.isNotNullOrEmpty(logMessage)) {
                    printStream.print(logMessage);
                }
                if (throwable != null) {
                    vo.setHasError(true);
                    printStream.println();
                    printStream.println(throwable.getClass() + ": " + throwable.getMessage());
                    throwable.printStackTrace(printStream);
                }
                printStream.flush();
            }

            output.flush();
            logMessage = output.toString();
        } catch(IOException e) {
            /* Shouldn't ever happen because StringWriter.close() is empty, ignore this */
        }
        vo.setLevel(level.name());
        vo.setDate(now);
        vo.setMessage(logMessage);
        messages.offer(vo);
    }

    /**
     * Log a message with trace log level.
     *
     * @param message log this message
     */
    public void trace(Object message) {
        queue(Level.Trace, message, null);
        passthrough.trace(message);
    }

    /**
     * Log an error with trace log level.
     *  @param message log this message
     * @param t log this cause
     */
    public void trace(Object message, Throwable t) {
        queue(Level.Trace, message, t);
        passthrough.trace(message, t);
    }

    /**
     * Log a message with warn log level.
     *
     * @param message log this message
     */
    public void warn(Object message) {
        queue(Level.Warn, message, null);
        passthrough.warn(message);
    }

    /**
     * Log an error with warn log level.
     *  @param message log this message
     * @param t log this cause
     */
    public void warn(Object message, Throwable t) {
        queue(Level.Warn, message, t);
        passthrough.warn(message, t);
    }
}
