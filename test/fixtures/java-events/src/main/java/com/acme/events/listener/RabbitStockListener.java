package com.acme.events.listener;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class RabbitStockListener {
    @RabbitListener(queues = "stock-sync-queue")
    public void process(String body) {
        System.out.println(body);
    }
}
