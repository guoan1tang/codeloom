package com.acme.orm.entity;

import com.baomidou.mybatisplus.annotation.TableName;

@TableName("t_product")
public class ProductEntity {
    private String id;
    private Integer status;
}
