package com.acme.shop.order;

import org.junit.jupiter.api.Test;

public class OrderControllerTest {
    @Test
    public void testCreateApi() {
        OrderController controller = new OrderController();
        controller.create("{}");
    }
}
