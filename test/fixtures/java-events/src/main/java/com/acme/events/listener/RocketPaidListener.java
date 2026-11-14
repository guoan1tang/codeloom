package com.acme.events.listener;

import org.apache.rocketmq.spring.annotation.RocketMQMessageListener;
import org.apache.rocketmq.spring.core.RocketMQListener;

@RocketMQMessageListener(topic = "order-paid", consumerGroup = "paid-group")
public class RocketPaidListener implements RocketMQListener<String> {
    @Override
    public void onMessage(String body) {
        System.out.println(body);
    }
}
