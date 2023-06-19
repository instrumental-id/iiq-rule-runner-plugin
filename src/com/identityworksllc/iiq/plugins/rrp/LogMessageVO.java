package com.identityworksllc.iiq.plugins.rrp;

import javax.xml.bind.annotation.XmlRootElement;
import java.util.Date;

@XmlRootElement
public class LogMessageVO {
    private long date;
    private boolean hasError;
    private String level;
    private String message;

    public long getDate() {
        return date;
    }

    public String getLevel() {
        return level;
    }

    public String getMessage() {
        return message;
    }

    public boolean isHasError() {
        return hasError;
    }

    public void setDate(long date) {
        this.date = date;
    }

    public void setDate(Date input) {
        this.date = input.getTime();
    }

    public void setHasError(boolean hasError) {
        this.hasError = hasError;
    }

    public void setLevel(String level) {
        this.level = level;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}
