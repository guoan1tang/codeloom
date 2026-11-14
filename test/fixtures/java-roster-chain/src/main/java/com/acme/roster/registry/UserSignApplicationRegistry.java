package com.acme.roster.registry;

import com.acme.roster.entity.UserSignApplication;
import com.acme.roster.mapper.UserSignApplicationMapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.stereotype.Service;

@Service
public class UserSignApplicationRegistry extends ServiceImpl<UserSignApplicationMapper, UserSignApplication> {
}