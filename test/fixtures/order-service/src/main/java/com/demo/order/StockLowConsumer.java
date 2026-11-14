package com.demo.order;

import org.apache.rocketmq.spring.annotation.RocketMQMessageListener;
import org.apache.rocketmq.spring.core.RocketMQListener;

@RocketMQMessageListener(topic = "stock-low", consumerGroup = "order-stock-low")
public class StockLowConsumer implements RocketMQListener<String> {
    @Override
    public void onMessage(String body) {
        System.out.println(body);
    }
}