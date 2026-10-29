package com.identityworksllc.iiq.plugins.rrp;

import com.fasterxml.jackson.annotation.JsonAutoDetect;

import javax.xml.bind.annotation.XmlRootElement;
import java.util.Date;

@XmlRootElement
@JsonAutoDetect(fieldVisibility = JsonAutoDetect.Visibility.ANY)
public class LogMessageVO {
    /**
     * The creation date of the log message
     */
    private long date;

    /**
     * True if an error is part of this message
     */
    private boolean hasError;

    /**
     * The level of the log message
     */
    private String level;

    /**
     * The message itself
     */
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
