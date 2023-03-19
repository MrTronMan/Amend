![](https://amend.mrtron.dev/images/amendfullcolor.png)

# Amend
A plugin that auto updates **paper** or **purpur** to the newest version based on the Minecraft version.
 ### The plugin updates your server right before shutdown and has a SUPER LOW CHANCE of causing any problems, but just incase please use at your own risk. 
 *(there have been no problems though so far based on different types of sized worlds and what else I have tested. Still, be careful anyways :D)*
 
# Download

Currently as of now you can download it on our new website @ [amend.mrtron.dev/download](https://amend.mrtron.dev/download)
 
 # How to make it work
 You can use either **paper** or **purpur**.
 It grabs the latest version from our API and just replaces the server jar.
 
 If you would like to use it there are a few things you need to do. 
 - First make sure purpur/paper is installed and name the jar to whatever you'd like. Please make sure to change it in the config though, so the system can find your jar file.
 ```yml
#
#    ╭━━━╮╱╱╱╱╱╱╱╱╱╱╭╮
#    ┃╭━╮┃╱╱╱╱╱╱╱╱╱╱┃┃
#    ┃┃╱┃┣╮╭┳━━┳━╮╭━╯┃
#    ┃╰━╯┃╰╯┃┃━┫╭╮┫╭╮┃
#    ┃╭━╮┃┃┃┃┃━┫┃┃┃╰╯┃
#    ╰╯╱╰┻┻┻┻━━┻╯╰┻━━╯

# --WHEN EDITING THIS CONFIG WHILE THE SERVER IS ON, DO NOT WORRY AS THE CONFIG REFRESHES TO SEE THE CHANGES YOU MADE.--

# This changes the jar file name. PLEASE MAKE SURE IT MATCHES THE JAR FILE NAME OR ELSE IT WILL CREATE A NEW JAR FILE.
# If you forget you are using a different server type instead of Purpur and the plugin is running, it will automatically override it to purpur.
jar-name: "server.jar"

# This how you can customize the type of server you would like. It is defaulted to "paper".
# The current options for selecting the server jar are "purpur" or "paper".
server-type: "paper"

# Config Version. Like every spigot dev, we ask that you DO NOT CHANGE THIS PLEASE.
config-version: 8
```
 - Then place the (plugin) jar in and it will automatically update it to the newest version, ***please note as of now the plugin is updating the latest `1.19.3` builds and will continue to update until a new release comes out, then you will need to come back here to get the newest plugin update.***
 
 Update checks for the plugin are currently unavailable to switch off, but we only create the update notification if its a critical update, not a fancy one.
 ###### © 2023 mrtron.dev. All Rights Reserved.
