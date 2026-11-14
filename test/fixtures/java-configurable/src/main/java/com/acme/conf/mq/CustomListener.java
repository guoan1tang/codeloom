package com.acme.conf.mq;

public class CustomListener {
    @OurMq(queues = "widget-queue")
    public void handle(String body) {
    }
}
