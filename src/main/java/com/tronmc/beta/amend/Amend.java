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

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.jeff_media.updatechecker.UpdateCheckSource;
import com.jeff_media.updatechecker.UpdateChecker;
import org.bukkit.Bukkit;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.plugin.java.JavaPlugin;

public final class Amend extends JavaPlugin {

    @Override
    public void onEnable() {
        this.saveDefaultConfig();
        FileConfiguration config = this.getConfig();
        getConfig().set("config-version", 7);
        saveConfig();

        new UpdateChecker(this, UpdateCheckSource.CUSTOM_URL, "https://api.tronmc.com/amend/versions/1.19.1") // A link to a URL that contains the latest version as String
                .setDownloadLink("https://amend.mrtron.dev/download") // You can either use a custom URL or the Spigot Resource ID
                .setNotifyOpsOnJoin(false) // Notify OPs on Join when a new version is found (default)
                .checkNow(); // And check right now
        getLogger().info("Amend is on standby, ready for updates on shutdown.");

    }

    @Override
    public void onDisable() {
        Bukkit.getLogger().info("Started Update Check...");
        reloadConfig();
        this.getConfig();
        FileConfiguration config = this.getConfig();
        String serverJarName = this.getConfig().getString("jar-name");
        URLConnection connection = null;
        try {
            connection = new URL("https://api.purpurmc.org/v2/purpur/1.19.1").openConnection();
        } catch (IOException e) {
            e.printStackTrace();
        }
        try(Scanner scanner = new Scanner(connection.getInputStream());){
            String response = scanner.useDelimiter("\\A").next();
            JsonObject jobj = new Gson().fromJson(response, JsonObject.class);
            String allbuilds = jobj.get("builds").toString();
            JsonObject jsonbuilds = new Gson().fromJson(allbuilds, JsonObject.class);
            String complatest = jsonbuilds.get("latest").toString();
            String simpleLatest = complatest.substring(1,5);
            int latest = Integer.parseInt(simpleLatest);
            String[] pathNames;
            File purpurJar = new File("../");
            pathNames = purpurJar.list();
            Bukkit.getLogger().warning("-------------------------------");
            Bukkit.getLogger().info("Amend");
            String BukkitVersion = Bukkit.getVersion().toString();
            Bukkit.getLogger().info("Current Version: " + BukkitVersion.substring(11,15));
            String simpleversion = BukkitVersion.substring(11,15);
            int version = Integer.parseInt(simpleversion);
            if (version != latest) {
                Bukkit.getLogger().warning("Version is NOT up to date! Newest purpur version is " + latest);
                Bukkit.getLogger().info("Downloading update and applying to " + serverJarName +  "...");
                InputStream in = new URL("https://api.purpurmc.org/v2/purpur/1.19.1/latest/download").openStream();
                Files.copy(in, Paths.get(serverJarName), StandardCopyOption.REPLACE_EXISTING);
                Bukkit.getLogger().info("Update Completed!");
                Bukkit.getLogger().warning("-------------------------------");
                try {
                    TimeUnit.SECONDS.sleep(3);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
                getLogger().info("Successfully updated and disabled Amend!");
            } else {
                Bukkit.getLogger().info("Server is up to date!");
                Bukkit.getLogger().info("Closing plugin...");
                Bukkit.getLogger().warning("-------------------------------");
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




    }
}
