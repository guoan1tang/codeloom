package com.acme.events.listener;

import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class AuditLogListener {
    @KafkaListener(topics = "audit-log")
    public void consume(String message) {
        System.out.println(message);
    }
}
