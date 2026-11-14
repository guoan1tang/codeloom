package com.demo.order;

import org.junit.jupiter.api.Test;

public class OrderServiceImplTest {
    @Test
    public void testCreateOrder() {
        OrderServiceImpl svc = new OrderServiceImpl();
        svc.createOrder("{}");
    }
}