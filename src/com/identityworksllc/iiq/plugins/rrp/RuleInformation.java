package com.identityworksllc.iiq.plugins.rrp;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonPropertyDescription;
import com.identityworksllc.iiq.common.Utilities;
import com.identityworksllc.iiq.common.plugin.vo.RestObject;
import sailpoint.object.Rule;
import sailpoint.object.SailPointObject;

import java.util.ArrayList;
import java.util.Map;
import java.util.HashMap;
import java.util.List;
import java.util.stream.Collectors;

@JsonAutoDetect(getterVisibility = JsonAutoDetect.Visibility.PUBLIC_ONLY)
@JsonInclude(JsonInclude.Include.NON_NULL)
public class RuleInformation extends RestObject {

    @JsonPropertyDescription("The description of this rule")
    private String description;

    @JsonPropertyDescription("The ID of the loaded Rule object")
    private String id;

    @JsonPropertyDescription("The list of Rule Libraries included by this Rule object")
    private List<String> libraries;

    @JsonPropertyDescription("The name of the loaded Rule object")
    private String name;

    @JsonPropertyDescription("The Beanshell source code of the Rule object")
    private String source;

    @JsonPropertyDescription("The type attribute of the Rule object, e.g., FieldValue")
    private String type;

    @JsonPropertyDescription("The list of input variables for the Rule")
    private Map<String, Object> variables;

    public RuleInformation() {
        /* For JSON */
    }

    public RuleInformation(Rule sourceRule) {
        this.id = sourceRule.getId();
        this.name = sourceRule.getName();
        this.source = sourceRule.getSource();
        this.libraries = Utilities.safeStream(sourceRule.getReferencedRules()).map(SailPointObject::getName).collect(Collectors.toList());
        this.type = sourceRule.getType() != null ? sourceRule.getType().name() : null;
        this.description = sourceRule.getSignature() != null ? sourceRule.getSignature().getDescription() : null;
        if (sourceRule.getSignature() != null && sourceRule.getSignature().getArguments() != null) {
            this.variables = new HashMap<>();
            RuleRunnerResource.populateArguments(sourceRule.getSignature(), this.type, this.variables);
        }
    }

    public String getDescription() {
        return description;
    }

    public String getId() {
        return id;
    }

    public List<String> getLibraries() {
        return libraries;
    }

    public String getName() {
        return name;
    }

    public String getSource() {
        return source;
    }

    public String getType() {
        return type;
    }

    public Map<String, Object> getVariables() {
        return variables;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public void setId(String id) {
        this.id = id;
    }

    public void setLibraries(List<String> libraries) {
        this.libraries = libraries;
    }

    public void setName(String name) {
        this.name = name;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public void setType(String type) {
        this.type = type;
    }

    public void setVariables(Map<String, Object> variables) {
        this.variables = variables;
    }
}
