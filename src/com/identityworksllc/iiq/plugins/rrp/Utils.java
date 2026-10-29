package com.identityworksllc.iiq.plugins.rrp;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import sailpoint.tools.Util;

import javax.servlet.http.HttpServletRequest;

public class Utils {
    public static final Log SYSTEM_LOG = LogFactory.getLog("com.identityworksllc.iiq.plugins.rrp.SystemLog");

    /**
     * Gets the remote IP address of the user from the given HttpServletRequest. This can
     * be used in a situation where there is no FacesContext, like in a web service call.
     *
     * @param request The request to grab the IP from
     * @return The remote IP of the user
     */
    public static String getRemoteIp(HttpServletRequest request) {
        String remoteAddr = null;
        if (request != null) {
            remoteAddr = request.getHeader("X-FORWARDED-FOR");
            if (Util.isNullOrEmpty(remoteAddr)) {
                remoteAddr = request.getRemoteAddr();
            }
        }
        return remoteAddr;
    }
}
