package com.demo.order.entity;

import com.baomidou.mybatisplus.annotation.TableName;

@TableName("t_order_entity")
public class OrderEntity {
    private String id;
    private Integer status;
}