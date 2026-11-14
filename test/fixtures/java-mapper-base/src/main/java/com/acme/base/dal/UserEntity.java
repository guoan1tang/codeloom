package com.acme.base.dal;

import com.baomidou.mybatisplus.annotation.TableName;

@TableName("t_sys_user")
public class UserEntity {
    private Long id;
    private String nickname;
}
