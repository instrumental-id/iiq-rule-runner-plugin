package com.identityworksllc.iiq.plugins.rrp;

import com.identityworksllc.iiq.common.cache.VersionedCacheMap;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import sailpoint.api.SailPointContext;
import sailpoint.api.SailPointFactory;
import sailpoint.object.Plugin;
import sailpoint.plugin.DatabaseFileHandler;
import sailpoint.tools.GeneralException;
import sailpoint.tools.IOUtil;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Caches the loaded plugin classes from each plugin. This is used by the {@link BeanshellSyntaxChecker}
 * to compile Beanshell code using exported plugin classes.
 *
 * The cache is versioned so that when a new plugin is installed, the cache is reset.
 */
public class PluginClassCache extends VersionedCacheMap<String, byte[]> {
    /**
     * Logger
     */
    private static final Log log = LogFactory.getLog(PluginClassCache.class);

    /**
     * Singleton instance of the PluginClassCache
     */
    private static final PluginClassCache INSTANCE = new PluginClassCache();

    /**
     * Gets the singleton instance of the PluginClassCache
     * @return the singleton instance of the PluginClassCache
     */
    public static PluginClassCache getInstance() {
        return INSTANCE;
    }

    /**
     * Private constructor to enforce singleton pattern
     */
    private PluginClassCache() {
        // Constructor is private to enforce singleton pattern
    }

    /**
     * Finds the plugin class in the cache. If the class is not found in the cache, it loads the
     * class from the plugin file. If the class is still not found, it is cached as an empty
     * byte array.
     *
     * If the cache contains an empty byte array, this method returns null.
     *
     * @param pluginName The plugin name from which to load the class
     * @param className The class to load from the plugin
     * @return The class data as a byte array, or null if the class is not found
     * @throws GeneralException If there is an error loading the class data
     */
    public byte[] findPluginClass(String pluginName, String className) throws GeneralException {
        SailPointContext context = SailPointFactory.getCurrentContext();

        log.debug("findPluginClass() - pluginName: " + pluginName + ", className: " + className);

        String cacheKey = pluginName + ":" + className;

        byte[] classData = get(cacheKey);
        if (classData == null) {
            log.trace("findPluginClass() - Cache miss for key: " + cacheKey);
            classData = loadPluginClass(context, pluginName, className);
            if (classData == null) {
                log.trace("findPluginClass() - Caching null class for plugin: " + pluginName + ", className: " + className);
                classData = new byte[0];
            }
            put(cacheKey, classData);
        }

        if (classData.length == 0) {
            return null;
        }

        return classData;
    }

    /**
     * Loads the plugin class from the plugin file by parsing it as a ZIP file, which
     * itself contains JAR files, which contain classes. If the class is not found, it
     * returns null.
     *
     * @param context The SailPointContext
     * @param pluginName The plugin name from which to load the class
     * @param className The class to load from the plugin
     * @return The class data as a byte array, or null if the class is not found
     * @throws GeneralException If there is an error loading the class data
     */
    private byte[] loadPluginClass(SailPointContext context, String pluginName, String className) throws GeneralException {
        DatabaseFileHandler fileHandler = new DatabaseFileHandler(context);
        Plugin plugin = context.getObject(Plugin.class, pluginName);
        try (InputStream is = fileHandler.readPluginFile(plugin)) {
            if (is == null) {
                log.info("loadPluginClass() - Unable to read plugin file for plugin: " + pluginName);
                return null;
            }

            try (ZipInputStream zis = new ZipInputStream(is)) {
                // The zip may contain JAR files which contain our class files
                for (java.util.zip.ZipEntry entry = zis.getNextEntry(); entry != null; entry = zis.getNextEntry()) {
                    String entryName = entry.getName();
                    if (entryName.endsWith(".jar")) {
                        log.trace("loadPluginClass() - Found JAR file in plugin: " + pluginName + ", entryName: " + entryName);
                        // Process the JAR file
                        ByteArrayOutputStream jarContentsBytes = new ByteArrayOutputStream();
                        IOUtil.copy(zis, jarContentsBytes);

                        try (ZipInputStream jarInputStream = new ZipInputStream(new ByteArrayInputStream(jarContentsBytes.toByteArray()))) {
                            for (ZipEntry jarEntry = jarInputStream.getNextEntry(); jarEntry != null; jarEntry = jarInputStream.getNextEntry()) {
                                if (jarEntry.isDirectory()) {
                                    continue; // Skip directories
                                }

                                String jarEntryName = jarEntry.getName();
                                if (jarEntryName.endsWith(".class")) {
                                    String javaName = jarEntryName.substring(0, jarEntryName.length() - ".class".length()).replace("/", ".");

                                    if (javaName.equals(className)) {
                                        // Found the class we are looking for
                                        ByteArrayOutputStream classBytes = new ByteArrayOutputStream();
                                        IOUtil.copy(jarInputStream, classBytes);
                                        byte[] classData = classBytes.toByteArray();
                                        log.trace("loadPluginClass() - Loaded class data for plugin: " + pluginName + ", className: " + className);
                                        return classData;
                                    } else {
                                        log.trace("loadPluginClass() - Skipping entry: " + jarEntryName);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            log.trace("loadPluginClass() - Class not found in plugin: " + pluginName + ", className: " + className);
            return null;
        } catch (Exception e) {
            log.error("loadPluginClass() - Error loading class data for plugin: " + pluginName, e);
            throw new GeneralException("Error loading class data for plugin: " + pluginName, e);
        }
    }
}
