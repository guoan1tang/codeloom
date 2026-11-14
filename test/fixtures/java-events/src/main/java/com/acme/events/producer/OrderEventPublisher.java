package com.acme.events.producer;

import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;

public class OrderEventPublisher {
    @Autowired
    private RabbitTemplate rabbitTemplate;

    public void publishPaid(String message) {
        rabbitTemplate.convertAndSend("order-paid", message);
    }

    public void publishExchange(Object message) {
        sendToMQ(message, Constants.ORDER_EXCHANGE, Constants.ORDER_ROUTING_KEY);
    }
}
