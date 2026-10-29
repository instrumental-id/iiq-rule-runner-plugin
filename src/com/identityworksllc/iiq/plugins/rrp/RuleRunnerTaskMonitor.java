package com.identityworksllc.iiq.plugins.rrp;

import sailpoint.task.Monitor;
import sailpoint.task.TaskMonitor;
import sailpoint.tools.GeneralException;
import sailpoint.tools.Util;

import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * The monitor for a {@link RuleRunnerResource.RuleRunnerAsyncWorker},
 * used to report the progress percentage and other information to the browser.
 *
 * All variables are atomic so that they can be accessed across multiple threads.
 */
public class RuleRunnerTaskMonitor implements Monitor {
    private boolean async;
    private final AtomicBoolean completed;
    private final AtomicInteger progressAmount;
    private final AtomicInteger progressMax;
    private final AtomicInteger progressPercent;
    private final AtomicReference<String> progressString;
    private transient TaskMonitor taskMonitor;
    private final AtomicBoolean terminated;

    public RuleRunnerTaskMonitor() {
        this.completed = new AtomicBoolean();
        this.progressString = new AtomicReference<String>();
        this.progressAmount = new AtomicInteger();
        this.progressMax = new AtomicInteger();
        this.progressPercent = new AtomicInteger();
        this.terminated = new AtomicBoolean();
        this.async = false;
    }

    @Override
    public void completed() {
        completed.set(true);
    }

    public void incrementProgress() {
        updateProgress(progressAmount.get() + 1, progressMax.get());
    }

    /**
     * @return True if we are running asynchronously
     */
    public boolean isAsync() {
        return async;
    }

    public boolean isTerminated() {
        return terminated.get();
    }

    /**
     * Indicates that we are running asynchronously
     * @param async The async flag
     */
    public void setAsync(boolean async) {
        this.async = async;
    }

    public void setTaskMonitor(TaskMonitor taskMonitor) {
        this.taskMonitor = taskMonitor;
    }

    public void setTotalItems(int amount) {
        this.progressMax.set(amount);
    }

    private void syncTaskMonitor() {
        if (this.taskMonitor != null) {
            if (Util.isNotNullOrEmpty(progressString.get())) {
                this.taskMonitor.updateProgress(progressString.get());
            } else if (this.progressMax.get() > 0) {
                this.taskMonitor.updateProgress("" + progressAmount.get() + " of " + progressMax.get() + " (" + progressPercent + "%)");
            }
        }
    }

    public void terminate() {
        this.terminated.set(true);
    }

    /**
     * Transforms this object to a Map for serialization as JSON
     * @return This object as a map
     */
    public Map<String, Object> toMap() {
        Map<String, Object> map = new TreeMap<>();
        if (Util.isNotNullOrEmpty(progressString.get())) {
            map.put("progressString", progressString.get());
        }
        map.put("progressPercent", progressPercent.get());
        map.put("progressAmount", progressAmount.get());
        map.put("progressMax", progressMax.get());
        map.put("completed", completed.get());
        return map;
    }

    public void updateProgress(int percent) {
        this.progressPercent.set(percent);
        syncTaskMonitor();
    }

    public void updateProgress(String progressString, int percentComplete) {
        updateProgress(progressString);
        progressPercent.set(percentComplete);
    }

    @Override
    public void updateProgress(String progressString, int progressPercent, boolean forceUpdate) throws GeneralException {
        this.progressString.set(progressString);
        this.progressPercent.set(progressPercent);
        syncTaskMonitor();
    }

    public void updateProgress(String ps) {
        this.progressString.set(ps);
        syncTaskMonitor();
    }

    public void updateProgress(int progressAmount, int progressMax) {
        this.progressAmount.set(progressAmount);
        this.progressMax.set(progressMax);
        this.progressPercent.set(Math.round((float) progressAmount / (float) progressMax * 100));

        syncTaskMonitor();
    }
}
