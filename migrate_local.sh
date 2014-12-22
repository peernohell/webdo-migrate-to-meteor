#!/bin/bash
mongodump -h 127.0.0.1 --port 3001 -d meteor && mongorestore -h 127.0.0.1 --port 8081 -d meteor ./dump/meteor/
