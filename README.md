This is a simple manga parser for [slashlib](https://v2.slashlib.me).
----
Available fuctions:
+ Successful site authorization (SocialLIB)
+ Handling popups like 'This is 18+ content'
+ Extracting chapter list with chapter links into `chapters.json`
+ You can edit `chapters.json` to specify which chapter you want to download.
+ Parser write logs into `app.log`. Always check logs.
+ All downloaded chapters will be in `downloads` folder at the script folder
----
### Installation

Clone this repository and install all needed modules by running command
`npm install`

After all modules will be installed, you should copy **config_example.json** into **config.json**
and update your login and password.

To run application type `npm start`

----
### Known issues
Application may hang after authorization procedure, so as a workaround just restart it.
