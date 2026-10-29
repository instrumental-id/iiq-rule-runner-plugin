import {ruleRunnerModule} from "../IIQModule";

import {ApplicationState} from "../ApplicationState";
import {FileUploadResponse, RuleRunnerService} from "./RuleRunnerService";
import {EventBus, EventType} from "./EventBus";

export class CsvFileUploadService {
    
    constructor(private applicationState: ApplicationState, private ruleRunnerService: RuleRunnerService, private eventBus: EventBus) {
    }
    
    async clearUploadedCsvFile(): Promise<void> {
        await this.ruleRunnerService.clearUploadedFile();
        this.applicationState.lastUploadedCsvFile = null;
    }
    
    async uploadCsvFile(file: File): Promise<void> {
        // TODO: Do we want to validate that the file is a CSV on the client side?
        
        let fileUploadResponse : FileUploadResponse = await this.ruleRunnerService.uploadFile(file);
        
        console.debug("Uploaded CSV file: ", fileUploadResponse);
        
        this.applicationState.lastUploadedCsvFile = fileUploadResponse;
    }
}

ruleRunnerModule.service('csvFileUploadService', CsvFileUploadService);