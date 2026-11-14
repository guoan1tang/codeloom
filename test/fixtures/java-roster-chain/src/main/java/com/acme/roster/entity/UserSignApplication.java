package com.acme.roster.entity;

import com.baomidou.mybatisplus.annotation.TableName;

@TableName(value = "user_sign_application")
public class UserSignApplication {
    private Long id;
    private Long companyId;
    private Long shopId;

    public Long getId() { return id; }
    public Long getCompanyId() { return companyId; }
    public Long getShopId() { return shopId; }
}