package com.acme.naming.registry;

import com.acme.naming.entity.UserPermissionEntity;
import com.acme.naming.mapper.UserPermissionMapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.stereotype.Service;

@Service
public class UserPermissionRegistry extends ServiceImpl<UserPermissionMapper, UserPermissionEntity> {
}