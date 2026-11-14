package com.acme.multi.order;

import com.acme.multi.order.service.impl.OrderServiceImpl;
import org.junit.jupiter.api.Test;

public class OrderServiceImplTest {
    @Test
    public void testCreate() {
        new OrderServiceImpl().createOrder("{}");
    }
}
