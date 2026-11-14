package com.demo.order.mq;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

@Component
public class RabbitStockConsumer {

    @RabbitListener(queues = "stock-low-queue")
    public void process(String body) {
        System.out.println(body);
    }
}