package com.acme.naming.entity;

import com.baomidou.mybatisplus.annotation.TableName;

/** Explicit annotation must win over the naming convention (would be "order"). */
@TableName("t_order_custom")
public class OrderPO {
    private Long id;

    public Long getId() { return id; }
}