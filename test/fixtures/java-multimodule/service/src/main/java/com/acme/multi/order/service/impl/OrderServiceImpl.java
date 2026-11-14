package com.acme.multi.order.service.impl;

import com.acme.multi.common.MoneyUtil;
import com.acme.multi.order.repo.OrderRepository;
import com.acme.multi.order.service.OrderService;
import org.springframework.beans.factory.annotation.Autowired;
import java.math.BigDecimal;

public class OrderServiceImpl implements OrderService {
    @Autowired
    private OrderRepository orderRepository;

    public String createOrder(String body) {
        orderRepository.save(body);
        return body;
    }

    public BigDecimal price(BigDecimal base) {
        return MoneyUtil.round(base);
    }
}
