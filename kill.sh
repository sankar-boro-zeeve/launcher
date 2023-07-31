#!/usr/bin/env bash

ps -ef | grep polkadot | grep -v grep | awk '{print $2}' | xargs kill
ps -ef | grep genesis- | grep -v grep | awk '{print $2}' | xargs kill
sudo rm -rf /tmp/*
sudo rm -rf ~/tmp

sudo lsof -i -P -n | grep LISTEN
