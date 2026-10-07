using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Newtonsoft.Json.Linq;

namespace RevitMCP.Core
{
    public partial class CommandExecutor
    {
        // Deliberately not available inside atomic plans or generated C#.
        private object CreateLightingFamilyFile(JObject input) { return CreateFamilyFile(input, true); }

        private object CreateFamilyFile(JObject input, bool lighting = false)
        {
            FamilyAuthoringSpec spec = FamilyAuthoringSpec.Parse(input);
            string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "BIMPersonalAgent", "FamilyExports");
            string folder = Path.Combine(root, Guid.NewGuid().ToString("N"));
            string target = Path.Combine(folder, spec.Name + ".rfa");
            string template = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "Autodesk", "RVT " + _uiApp.Application.VersionNumber, "Family Templates", "English", spec.TemplateName ?? (lighting ? "Metric Lighting Fixture.rft" : "Metric Generic Model.rft"));
            if (string.IsNullOrEmpty(spec.SourcePath) && !File.Exists(template)) throw new InvalidOperationException("Installed lighting template missing: " + template);
            if (_uiApp.ActiveUIDocument?.Document.IsModifiable == true)
                throw new InvalidOperationException("Family export must run outside a project transaction.");
            // User-authorized new-file / save-copy workflow: never overwrite a source
            // or load/replace a project family. No destructive confirmation required.
            if (!string.IsNullOrEmpty(spec.SourcePath) && !File.Exists(spec.SourcePath))
                throw new InvalidOperationException("Source RFA does not exist.");
            Document family = null;
            Document reopened = null;
            bool saved = false;
            try
            {
                if (string.IsNullOrEmpty(spec.SourcePath)) family = _uiApp.Application.NewFamilyDocument(template);
                else {
                    Directory.CreateDirectory(folder);
                    string copy = Path.Combine(folder, "source-copy.rfa");
                    File.Copy(spec.SourcePath, copy, false);
                    family = _uiApp.Application.OpenDocumentFile(copy);
                }
                if (!family.IsFamilyDocument) throw new InvalidOperationException("Expected an RFA family document.");
                int expectedCategory = family.OwnerFamily.FamilyCategory.Id.IntegerValue;
                List<FamilyGeometryEvidence> geometry;
                List<FamilyGeometryEvidence> identities;
                using (var tx = new Transaction(family, "Build lighting family"))
                {
                    tx.Start();
                    var failures = new FamilyBuildFailures();
                    tx.SetFailureHandlingOptions(tx.GetFailureHandlingOptions().SetFailuresPreprocessor(failures).SetClearAfterRollback(true));

                    FamilyManager fm = family.FamilyManager;
                    var selectedType = fm.Types.Cast<FamilyType>().FirstOrDefault(t => t.Name == spec.Name);
                    if(selectedType != null) fm.CurrentType = selectedType;
                    else fm.NewType(spec.Name);
                    foreach (var pair in spec.Metadata)
                    {
                        FamilyParameter p = fm.get_Parameter("BPA_" + pair.Key) ?? fm.AddParameter("BPA_" + pair.Key, GroupTypeId.IdentityData, SpecTypeId.String.Text, false);
                        fm.Set(p, pair.Value);
                    }
                    geometry = BuildFamilyGeometry(family, spec, out identities);
                    family.Regenerate();
                    if(tx.Commit()!=TransactionStatus.Committed) throw new InvalidOperationException("Family transaction did not commit: " + string.Join("; ", failures.Errors));
                }
                Directory.CreateDirectory(folder);
                family.SaveAs(target, new SaveAsOptions { OverwriteExistingFile = false, MaximumBackups = 1 });
                saved = true;
                if(!family.Close(false)) throw new InvalidOperationException("Could not close created family.");
                family = null;
                reopened = _uiApp.Application.OpenDocumentFile(target);
                if(!reopened.IsFamilyDocument || reopened.OwnerFamily.FamilyCategory.Id.IntegerValue != expectedCategory)
                    throw new InvalidOperationException("Saved family category verification failed.");
                VerifyFamilyGeometry(reopened, geometry, identities);
                var manager = reopened.FamilyManager;
                if(manager.CurrentType.Name!=spec.Name) throw new InvalidOperationException("Saved type mismatch.");
                foreach(var pair in spec.Metadata)
                    if(manager.CurrentType.AsString(manager.get_Parameter("BPA_"+pair.Key))!=pair.Value)
                        throw new InvalidOperationException("Saved metadata mismatch: "+pair.Key);
                return new { Status="verified", Path=target, FileCreated=true, Reopened=true, Category=reopened.OwnerFamily.FamilyCategory.Name, CategoryId=expectedCategory, SourcePreserved=true, Mode=string.IsNullOrEmpty(spec.SourcePath)?"create":"edit-copy", Parts=identities, FinalGeometry=geometry, Metadata=spec.Metadata,
                    Limitations="Native editable extrusions/revolutions/sweeps and explicit void cuts. Saved bounds, volume and form identity verified; photometry, electrical connectors, parameter flex and project loading not validated." };
            }
            catch(Exception ex)
            {
                throw new InvalidOperationException("Family authoring failed; verified=false; fileCreated=" +
                    (saved || File.Exists(target)) + "; path=" + target + "; " + ex.Message, ex);
            }
            finally
            {
                if(reopened!=null && reopened.IsValidObject) reopened.Close(false);
                if(family!=null && family.IsValidObject) family.Close(false);
            }
        }
    }

}
