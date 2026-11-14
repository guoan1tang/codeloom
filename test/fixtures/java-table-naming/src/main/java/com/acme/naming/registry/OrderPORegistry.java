package com.acme.naming.registry;

import com.acme.naming.entity.OrderPO;
import com.acme.naming.mapper.OrderPOMapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.stereotype.Service;

@Service
public class OrderPORegistry extends ServiceImpl<OrderPOMapper, OrderPO> {
}