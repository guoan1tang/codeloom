package com.acme.naming;

import com.acme.naming.entity.OrderPO;
import com.acme.naming.registry.OrderPORegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class OrderPOManager {
    @Autowired
    private OrderPORegistry orderPORegistry;

    public OrderPO get(Long id) {
        return orderPORegistry.getById(id);
    }
}