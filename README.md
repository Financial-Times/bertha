# bertha

Bertha is a machine that can produce any item requested of her.

## Using Bertha

[See the user docs](https://github.com/ft-interactive/bertha/wiki/Tutorial)

## Running Bertha locally

### Prerequisites

Setup tooling

* [Heroku CLI](https://github.com/Financial-Times/next/wiki/Heroku)
* [Doppler CLI](https://docs.doppler.com/docs/install-cli)
* [Volta](https://docs.volta.sh/guide/getting-started)
* [Redis](https://redis.io/docs/install/install-redis/install-redis-on-mac-os/)

then install the dependencies

```
$ npm i
```

### Start

```
$ npm start
```

The application will now be available on [http://localhost:3000/]. A (simple test sheet](http://localhost:3000/view/publish/gss/1WwwQqmkTz5zwq1fV0rrSG9JVfrpComLvqxyadj0qnG8/Test) is used to demonstrate everything working. From there you can visit the correct url according to the [user docs](https://github.com/ft-interactive/bertha/wiki/Tutorial).

You may overide the port thus:

```
$ PORT=8888 npm start
```

### Redis

If you find your local Redis isn't running/unreachable you can start it in another terminal/process

```
$ redis-server
```

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
