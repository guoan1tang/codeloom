package com.acme.events.listener;

import org.springframework.amqp.rabbit.annotation.RabbitHandler;
import org.springframework.amqp.rabbit.annotation.RabbitListener;

@RabbitListener(queues = "stock-alert-queue")
public class StockAlertHandler {
    @RabbitHandler
    public void handle(String body) {
        System.out.println(body);
    }
}
