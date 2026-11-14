package com.acme.multi.order.service;

import java.math.BigDecimal;

public interface OrderService {
    String createOrder(String body);
    BigDecimal price(BigDecimal base);
}
