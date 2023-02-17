# bertha

Bertha is a machine that can produce any item requested of her.

## Using Bertha

[See the user docs](https://github.com/ft-interactive/bertha/wiki/Tutorial)

## Running Bertha locally

### Prerequisites

You will need to be logged into Heroku-cli - find instructions [in the Next wiki](https://github.com/Financial-Times/next/wiki/Heroku#single-sign-on). You will also need Redis installed (`brew install redis` or [follow instructions here](https://redis.io/topics/quickstart)).

### First time

The first time you run Bertha you'll need a `.env` file. You can copy this from staging by running the following command in your terminal: `heroku config -s -a ft-ig-bertha-s > .env`

### Every time

- From the terminal run `redis-server`
- From a different tab run `heroku local`

From there you should see which port the server is running on and visit the correct url according to the [user docs](https://github.com/ft-interactive/bertha/wiki/Tutorial)

## Production

### Logs

Heroku router and app logs are sent to Splunk via the Heroku log drain.

Query the logs:


```
index=heroku source=bertha
```

### Monitoring

There are checks in Pingdom.

The app does not have a `/__health` endpoint because if it is unhealthy the app is down and Pingdom checks will fail.
