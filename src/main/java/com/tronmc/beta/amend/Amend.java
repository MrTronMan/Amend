package com.tronmc.beta.amend;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.net.URLConnection;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Scanner;
import java.util.concurrent.TimeUnit;

import com.jeff_media.updatechecker.UpdateCheckSource;
import com.jeff_media.updatechecker.UpdateChecker;
import org.bstats.bukkit.Metrics;
import org.bukkit.Bukkit;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.plugin.java.JavaPlugin;

public final class Amend extends JavaPlugin {

    @Override
    public void onEnable() {
        Integer configcheck = getConfig().getInt("config-version");
        //If the integer in the config is less than the config number (old) then it will rename the old one and create a fresh one.
        if (configcheck < 9) {
            File config = new File(getDataFolder(), "config.yml");
            File oldconfig = new File(getDataFolder(), "config_1.8.0.yml");
            boolean configFlag = config.renameTo(oldconfig);
            this.saveDefaultConfig();
            if (configFlag) {
                getLogger().warning("New config version! PLEASE CHECK THE CONFIG FOLDER!!");
                //Timeout so user sees message.
                try {
                    TimeUnit.SECONDS.sleep(3);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            } else {
                getLogger().warning("An error occurred creating a new config file.");
                //Timeout so user sees message.
                try {
                    TimeUnit.SECONDS.sleep(3);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }

            //If the config is = to the config number (newest) then just leave the config alone.
        } else if (configcheck == 9) {
            File config = new File(getDataFolder(), "config.yml");
            if (!config.exists()) {
                getLogger().warning("Hey! Welcome to Amend! Check out the config!");
               //Times out so user can see the message.
                try {
                    TimeUnit.SECONDS.sleep(5);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }
            saveDefaultConfig();

            //If the config is greater than the config number (n/a) then warn the user to change the config number to one lower.
        } else if (configcheck > 9) {
            this.saveDefaultConfig();
            FileConfiguration config = this.getConfig();
            getLogger().warning("Woah! Your config version is higher then it is supposed to!");
            getLogger().warning("We recommend that you set the config version to 8 so it automatically updates.");
            //Timeout so user sees message.
            try {
                TimeUnit.SECONDS.sleep(3);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }

        //Update Checker that checks our API for the latest using a handy dependency called SpigotUpdateChecker.
        new UpdateChecker(this, UpdateCheckSource.CUSTOM_URL, "https://api.tronmc.com/amend/versions/1.21.7") // A link to a URL that contains the latest version as String
                .setDownloadLink("https://amend.mrtron.dev/download") // You can either use a custom URL or the Spigot Resource ID
                .setNotifyOpsOnJoin(false) // Notify OPs on Join when a new version is found (default)
                .checkNow(); // And check right now
        int pluginId = 16293;
        Metrics metrics = new Metrics(this, pluginId);
        getLogger().info("Amend is on standby, ready for updates on shutdown.");
    }

    @Override
    public void onDisable() {
        getLogger().info("Started Update Check...");

        //Plugin Version
        String pluginVersion = "1.21.7";

        //Changes the Bukkit Version to a string and then gets the jar version and the MC version.
        String AUTOseverType = Bukkit.getServer().getName();
        String BukkitVersion = Bukkit.getVersion().toString();
        String MCandVersion = BukkitVersion.substring(0, BukkitVersion.lastIndexOf("-"));
        String jarVersion = MCandVersion.substring(MCandVersion.indexOf("-") + 1);;
        String MCVersion = MCandVersion.substring(0, MCandVersion.lastIndexOf("-"));


        //Double Check if the user made any changes that the config will be the correct way by refreshing.
        reloadConfig();
        FileConfiguration config = getConfig();
        //Grabs the latest version from purpur API and gets the jar-name from the config. Gets other configurations as well.
        String serverJarName = getConfig().getString("jar-name");
        String ServerType = getConfig().getString("server-type");
        //Boolean ForcedUpdate = this.getConfig().getBoolean("force-update");

        //the AUTO setting
        if (ServerType.equals("AUTO")) {
            getLogger().info("AUTO is enabled, checking server type...");

            if (AUTOseverType.equals("Paper")) {
                getLogger().info("AUTO detected: " + AUTOseverType);
                ServerType = "paper";
            } else if (AUTOseverType.equals("Purpur")) {
                getLogger().info("AUTO detected: " + AUTOseverType);
                ServerType = "purpur";
            } else {
                getLogger().warning("-------------------------------");
                getLogger().warning("Amend");
                getLogger().warning("ERROR: AUTO detected a server type that is invalid! Please check the version/force a server type in config.");
                getLogger().warning("Current Version: " + jarVersion + " (MC: " + MCVersion + ")");
                getLogger().warning("Plugin Version: " + pluginVersion);
                getLogger().warning("Server Type Detected: " + AUTOseverType);
                getLogger().warning("Closing plugin...");
                getLogger().warning("-------------------------------");
                //Time out so user sees the error message.
                try {
                    TimeUnit.SECONDS.sleep(3);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
                getLogger().info("Successfully disabled Amend!");
                getServer().getPluginManager().disablePlugin(this);
            }
        }

        if (MCVersion.equals("1.21.7")) {

            //Converts the jar version to an integer for comparsion
            //moved this because some servers have a different versioning system (ex. Spigot) and would run into an exception before
            //auto could recognize the server type.
            //so moving this here makes it check if its paper or purpur first and not cause an exception
            int version = Integer.parseInt(jarVersion);


            if (ServerType.equals("paper")) {
                URLConnection connection = null;
                try {
                    connection = new URL("https://api.tronmc.com/amend/versions/paper/1.21.7").openConnection();
                } catch (IOException e) {
                    e.printStackTrace();
                }
                try (Scanner scanner = new Scanner(connection.getInputStream())) {
                    String response = scanner.useDelimiter("\\A").next();
                    int latest = Integer.parseInt(response);
                    String[] pathNames;
                    File ServerJar = new File("../");
                    pathNames = ServerJar.list();
                    getLogger().warning("-------------------------------");
                    getLogger().info("Amend");
                    if (ServerType.equals("AUTO")) {
                        getLogger().info("AUTO server type detected: " + AUTOseverType.toUpperCase());
                    } else {
                        getLogger().info("Server-Type Selected: " + ServerType.toUpperCase());
                    }
                    getLogger().info("Current Version: " + jarVersion + " (MC: " + MCVersion + ")");

                    //===========================
                    //PAPER VERSION OF UPDATER
                    //===========================
                    //If the version is not up-to-date it will grab the latest version and download and replace the file and name it based
                    //on the config.
                    if (version != latest) {
                        getLogger().warning("Version is NOT up to date! Newest PAPER version is " + latest);
                        getLogger().info("Downloading update and applying to " + serverJarName + "...");
                        InputStream in = new URL("https://api.tronmc.com/amend/versions/paper/1.21.7/download/direct").openStream();
                        Files.copy(in, Paths.get(serverJarName), StandardCopyOption.REPLACE_EXISTING);
                        getLogger().info("Update Completed!");
                        getLogger().warning("-------------------------------");
                        try {
                            TimeUnit.SECONDS.sleep(3);
                        } catch (InterruptedException e) {
                            e.printStackTrace();
                        }
                        getLogger().info("Successfully updated and disabled Amend!");
                    } else {
                        getLogger().info("Server is up to date!");
                        getLogger().info("Closing plugin...");
                        getLogger().warning("-------------------------------");
                        try {
                            TimeUnit.SECONDS.sleep(3);
                        } catch (InterruptedException e) {
                            e.printStackTrace();
                        }
                        getLogger().info("Successfully disabled Amend!");

                    }
                } catch (IOException e) {
                    e.printStackTrace();
                }
            } else if (ServerType.equals("purpur")) {
                URLConnection connection = null;
                try {
                    connection = new URL("https://api.tronmc.com/amend/versions/purpur/1.21.7").openConnection();
                } catch (IOException e) {
                    e.printStackTrace();
                }
                try (Scanner scanner = new Scanner(connection.getInputStream())) {
                    String response = scanner.useDelimiter("\\A").next();
                    int latest = Integer.parseInt(response);
                    String[] pathNames;
                    File ServerJar = new File("../");
                    pathNames = ServerJar.list();
                    getLogger().warning("-------------------------------");
                    getLogger().info("Amend");
                    if (ServerType.equals("AUTO")) {
                        getLogger().info("AUTO server type detected: " + AUTOseverType.toUpperCase());
                    } else {
                        getLogger().info("Server-Type Selected: " + ServerType.toUpperCase());
                    }
                    getLogger().info("Current Version: " + jarVersion + " (MC: " + MCVersion + ")");

                    //===========================
                    //PURPUR VERSION OF UPDATER
                    //===========================
                    //If the version is not up-to-date it will grab the latest version and download and replace the file and name it based
                    //on the config.
                    if (version != latest) {
                        getLogger().warning("Version is NOT up to date! Newest PURPUR version is " + latest);
                        getLogger().info("Downloading update and applying to " + serverJarName + "...");
                        InputStream in = new URL("https://api.tronmc.com/amend/versions/purpur/1.21.7/download/direct").openStream();
                        Files.copy(in, Paths.get(serverJarName), StandardCopyOption.REPLACE_EXISTING);
                        getLogger().info("Update Completed!");
                        getLogger().warning("-------------------------------");
                        try {
                            TimeUnit.SECONDS.sleep(3);
                        } catch (InterruptedException e) {
                            e.printStackTrace();
                        }
                        getLogger().info("Successfully updated and disabled Amend!");
                    } else {
                        getLogger().info("Server is up to date!");
                        getLogger().info("Closing plugin...");
                        getLogger().warning("-------------------------------");
                        getLogger().info("Successfully disabled Amend!");
                        getServer().getPluginManager().disablePlugin(this);
                    }
                } catch (IOException e) {
                    e.printStackTrace();
                }
            } else {
                getLogger().warning("-------------------------------");
                getLogger().warning("Amend");
                getLogger().warning("ERROR: Invalid Server Type! Please check the config.");
                getLogger().warning("Current Version: " + jarVersion + " (MC: " + MCVersion + ")");
                getLogger().warning("Plugin Version: " + pluginVersion);
                getLogger().warning("Server Type: " + ServerType);
                getLogger().warning("Closing plugin...");
                getLogger().warning("-------------------------------");
                //Time out so user sees the error message.
                try {
                    TimeUnit.SECONDS.sleep(3);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
                getLogger().info("Successfully disabled Amend!");
                getServer().getPluginManager().disablePlugin(this);
            }
        } else {
            getLogger().warning("-------------------------------");
            getLogger().warning("Amend");
            getLogger().warning("ERROR: Your server version is older/newer, to prevent accidental updates to the world, amend will shut down.");
            getLogger().warning("Your Server Version: " + MCVersion);
            getLogger().warning("Plugin Version: " + pluginVersion);
            getLogger().warning("Closing plugin...");
            getLogger().warning("-------------------------------");
            //Time out so user sees the error message.
            try {
                TimeUnit.SECONDS.sleep(3);
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
            getLogger().info("Successfully disabled Amend!");
            getServer().getPluginManager().disablePlugin(this);
        }
    }
}
