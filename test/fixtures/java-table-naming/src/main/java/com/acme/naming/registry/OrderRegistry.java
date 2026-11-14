package com.acme.naming.registry;

import com.acme.naming.entity.OrderEntity;
import com.acme.naming.mapper.OrderMapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.stereotype.Service;

@Service
public class OrderRegistry extends ServiceImpl<OrderMapper, OrderEntity> {
}