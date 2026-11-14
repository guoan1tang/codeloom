package com.demo.order.mq;

import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class RabbitStockSender {
    @Autowired
    private RabbitTemplate rabbitTemplate;

    public void send(String body) {
        rabbitTemplate.convertAndSend("stock-low-queue", body);
    }

    public void sendToExchange(Object message) {
        sendToMQ(message, Constants.STOCK_EXCHANGE, Constants.STOCK_ROUTING_KEY);
    }
}