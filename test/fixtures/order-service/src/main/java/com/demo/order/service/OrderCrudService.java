package com.demo.order.service;

import com.demo.order.entity.OrderEntity;
import com.demo.order.mapper.OrderBaseMapper;
import org.springframework.beans.factory.annotation.Autowired;

public class OrderCrudService {
    @Autowired
    private OrderBaseMapper orderBaseMapper;

    public OrderEntity load(String id) {
        return orderBaseMapper.selectById(id);
    }

    public void save(OrderEntity entity) {
        orderBaseMapper.insert(entity);
    }
}