package com.identityworksllc.iiq.plugins.rrp;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.identityworksllc.iiq.common.plugin.vo.RestObject;
import sailpoint.tools.Util;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@JsonAutoDetect(getterVisibility = JsonAutoDetect.Visibility.ANY)
@JsonInclude(JsonInclude.Include.NON_NULL)
public class RunRuleOutcome extends RestObject {

    /**
     * True if this rule was started in the background
     */
    private boolean async;

    /**
     * The time elapsed since start
     */
    private Long elapsed;
    /**
     * True if the rule encountered an error getting started
     */
    private boolean error;
    /**
     * The host on which this rule is being executed
     */
    private String host;
    /**
     * The latest set of queued logs associated with this rule
     */
    private List<LogMessageVO> logs;
    /**
     * The output of the rule, if it is finished
     */
    private Object output;
    /**
     * The stats of the rule
     */
    private Map<String, Object> stats;
    /**
     * True if the rule has finished running, false otherwise
     */
    private boolean terminated;
    /**
     * The timestamp at which this object was generated
     */
    private final long timestamp;
    /**
     * The UUID of the rule thread
     */
    private String uuid;

    public RunRuleOutcome() {
        this.error = false;
        this.async = false;
        this.terminated = false;
        this.host = Util.getHostName();
        this.timestamp = System.currentTimeMillis();
    }

    public Long getElapsed() {
        return this.elapsed;
    }

    public String getHost() {
        return host;
    }

    public List<LogMessageVO> getLogs() {
        return logs;
    }

    public Object getOutput() {
        return output;
    }

    public Map<String, Object> getStats() {
        return stats;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public String getUuid() {
        return uuid;
    }

    public boolean isAsync() {
        return async;
    }

    public boolean isError() {
        return error;
    }

    public boolean isTerminated() {
        return terminated;
    }

    public void setAsync(boolean async) {
        this.async = async;
    }

    public void setElapsed(long elapsed) {
        this.elapsed = elapsed;
    }

    public void setError(boolean error) {
        this.error = error;
    }

    public void setHost(String host) {
        this.host = host;
    }

    public void setLogs(List<LogMessageVO> logs) {
        this.logs = new ArrayList<>(logs);
    }

    public void setOutput(Object output) {
        this.output = output;
    }

    public void setStats(Map<String, Object> stats) {
        this.stats = stats;
    }

    public void setTerminated(boolean terminated) {
        this.terminated = terminated;
    }

    public void setUuid(String uuid) {
        this.uuid = uuid;
    }
}
