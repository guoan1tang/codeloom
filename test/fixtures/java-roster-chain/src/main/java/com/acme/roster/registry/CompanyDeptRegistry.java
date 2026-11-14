package com.acme.roster.registry;

import com.acme.roster.entity.CompanyDept;
import com.acme.roster.mapper.CompanyDeptMapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.stereotype.Service;

@Service
public class CompanyDeptRegistry extends ServiceImpl<CompanyDeptMapper, CompanyDept> {
}