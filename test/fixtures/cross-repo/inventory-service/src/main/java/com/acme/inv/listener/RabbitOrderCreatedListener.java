package com.acme.inv.listener;

import org.springframework.amqp.rabbit.annotation.RabbitListener;

public class RabbitOrderCreatedListener {
    @RabbitListener(queues = "order-created")
    public void onOrder(String body) {
        System.out.println(body);
    }
}
