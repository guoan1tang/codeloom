package com.demo.order;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

@Service
public class OrderServiceImpl implements OrderService {
    @Autowired
    private InventoryFeignClient inventoryFeignClient;
    @Autowired
    private MqProducer mqProducer;

    public void createOrder(String body) {
        inventoryFeignClient.deduct(body);
        mqProducer.send("order-created", body);
    }
}