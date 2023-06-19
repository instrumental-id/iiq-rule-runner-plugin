package com.identityworksllc.iiq.plugins.rrp;

import javax.servlet.http.HttpServletRequest;

public class Utils {
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
            if (remoteAddr == null || "".equals(remoteAddr)) {
                remoteAddr = request.getRemoteAddr();
            }
        }
        return remoteAddr;
    }
}
