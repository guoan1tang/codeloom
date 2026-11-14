package com.acme.order.service;

import com.acme.order.client.InventoryApiClient;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;

public class OrderService {
    @Autowired
    private InventoryApiClient inventoryApiClient;
    @Autowired
    private RabbitTemplate rabbitTemplate;

    public String createOrder(String body) {
        inventoryApiClient.callDeduct(body);
        rabbitTemplate.convertAndSend("order-created", body);
        return body;
    }
}
