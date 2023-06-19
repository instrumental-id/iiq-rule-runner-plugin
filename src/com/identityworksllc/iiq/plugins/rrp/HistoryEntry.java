package com.identityworksllc.iiq.plugins.rrp;

import sailpoint.object.AuditEvent;
import sailpoint.tools.Util;

import java.util.ArrayList;
import java.util.List;

public class HistoryEntry {
    private boolean includeWebClasses;
    private List<String> libraries;
    private String source;
    private long timestamp;

    public HistoryEntry() {
        this.libraries = new ArrayList<>();
    }

    public HistoryEntry(AuditEvent ae) {
        this.setSource(ae.getString("code"));
        this.setLibraries(ae.getAttributes().getStringList("libraries"));
        this.setTimestamp(ae.getCreated().getTime());
        this.setIncludeWebClasses(Util.otob(ae.getAttribute("includeWebClasses")));

        if (this.libraries == null) {
            this.libraries = new ArrayList<>();
        }
    }

    public List<String> getLibraries() {
        return libraries;
    }

    public String getSource() {
        return source;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public boolean isIncludeWebClasses() {
        return includeWebClasses;
    }

    public void setIncludeWebClasses(boolean includeWebClasses) {
        this.includeWebClasses = includeWebClasses;
    }

    public void setLibraries(List<String> libraries) {
        this.libraries = libraries;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public void setTimestamp(long timestamp) {
        this.timestamp = timestamp;
    }
}
