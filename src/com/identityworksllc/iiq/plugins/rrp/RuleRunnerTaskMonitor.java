package com.identityworksllc.iiq.plugins.rrp;

import sailpoint.task.Monitor;
import sailpoint.tools.GeneralException;
import sailpoint.tools.Util;

import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

public class RuleRunnerTaskMonitor implements Monitor {
    private final AtomicBoolean completed;
    private final AtomicInteger progressAmount;
    private final AtomicInteger progressMax;
    private final AtomicInteger progressPercent;
    private final AtomicReference<String> progressString;

    public RuleRunnerTaskMonitor() {
        this.completed = new AtomicBoolean();
        this.progressString = new AtomicReference<String>();
        this.progressAmount = new AtomicInteger();
        this.progressMax = new AtomicInteger();
        this.progressPercent = new AtomicInteger();
    }

    @Override
    public void completed() {
        completed.set(true);
    }

    public Map<String, Object> toMap() {
        Map<String, Object> map = new TreeMap<>();
        if (Util.isNotNullOrEmpty(progressString.get())) {
            map.put("progressString", progressString.get());
        }
        map.put("progressPercent", progressPercent.get());
        map.put("progressAmount", progressAmount.get());
        map.put("progressMax", progressMax.get());
        return map;
    }

    public void updateProgress(int percent) {
        this.progressPercent.set(percent);
    }

    public void updateProgress(String progressString, int percentComplete) {
        updateProgress(progressString);
        progressPercent.set(percentComplete);
    }

    @Override
    public void updateProgress(String s, int i, boolean b) throws GeneralException {
        updateProgress(s, i);
    }

    public void updateProgress(String ps) {
        this.progressString.set(ps);
    }

    public void updateProgress(int progressAmount, int progressMax) {
        this.progressAmount.set(progressAmount);
        this.progressMax.set(progressMax);
        this.progressPercent.set(Math.round((float) progressAmount / (float) progressMax * 100));
    }
}
