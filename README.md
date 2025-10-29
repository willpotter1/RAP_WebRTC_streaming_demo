In SEPARATE terminals:

## Terminal 1:

To open the websocket server
```
node server.js
```

## Terminal 2

To run the application:
```
npm run dev
```
You should see something like:
> Local:    http://localhost:3000/   
> Network:  http://10.122.141.131:3000/

click (either) link twice to get 2 tabs.

## Using application

### Tab 1

Click "initialize" next to "I am a: Streamer"

Click "Start Streaming"

Copy the ID at the bottom of the page.

Now switch to tab 2

##

Select "Viewer" from the dropdown menu.

Click "initialize" next to "I am a: Viewer"

Paste ID from tab 1 into box that says "Enter Streamer ID" then click "Connect and Watch"

(Optional) Select different stream from dropdown menu

